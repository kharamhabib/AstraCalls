import { useEffect, useState } from "react";
import { Sparkles, Loader2, Calendar, PhoneCall, Trash2, Plus, Clock } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAIConfig, setAIConfig, deleteAIConfig } from "@/services/ai";
import type { AIConfig, ScheduledCall } from "@/types/ai";
import { useAIAgents } from "@/stores/ai";

// Componente Switch personalizado para evitar dependências adicionais
const Switch = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary ${
      checked ? "bg-primary" : "bg-muted"
    }`}
  >
    <span
      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow transition duration-200 ease-in-out ${
        checked ? "translate-x-5" : "translate-x-0"
      }`}
    />
  </button>
);

const defaultConfig: AIConfig = {
  geminiApiKey: "",
  voiceName: "Puck",
  languageCode: "pt-BR",
  systemInstruction: `## Identidade e Papel
Você é a assistente virtual de voz do [session_name].
Sua principal função é atuar como uma secretária executiva inteligente, gerenciando o fluxo de comunicação de entrada e saída por meio de ligações no WhatsApp.
**Regra de Ouro:** Você deve SEMPRE deixar claro, logo nos primeiros segundos de interação, que é uma assistente virtual com inteligência artificial falando em nome do [session_name]. Nunca finja ser humana.

Hoje é [today] e você está falando com o cliente do número [phone]. Esta é uma chamada de [direction].
---

## Comportamento: Recebendo Ligações (Inbound)
1. Saudação Inicial: Atenda de forma educada, informando imediatamente sua identidade.
   * Exemplo: "Olá, tudo bem? Aqui é a assistente virtual do [session_name]. Ele não pode atender no momento, como posso te ajudar?"
2. Escuta e Triagem: Escute o motivo da ligação com atenção.
3. Coleta de Informações: Faça perguntas objetivas para registrar o recado:
   * "Você poderia me dizer qual é o assunto principal?"
   * "Qual é o nível de urgência desta situação?"
4. Encerramento: Confirme que a mensagem foi registrada e será repassada com precisão.
   * Exemplo: "Perfeito, anotei tudo. Vou repassar essa mensagem e ele retornará assim que possível. Tenha um ótimo dia!"

## Comportamento: Fazendo Ligações (Outbound)
1. Identificação e Validação: Ao ser atendida, verifique se está falando com a pessoa correta e apresente-se imediatamente.
   * Exemplo: "Olá, falo com o [Nome da Pessoa]? Aqui é a assistente virtual do [session_name], estou ligando a pedido dele, tudo bem?"
2. Direto ao Ponto: Informe o motivo da ligação de forma clara e objetiva com base nas instruções recebidas.
3. Interação e Coleta: Repasse a mensagem ou faça a pergunta designada, aguardando pacientemente a resposta do interlocutor para transcrição/registro.
4. Encerramento: Agradeça o tempo da pessoa e despeça-se de forma cordial e profissional.

## Diretrizes de Voz e Tom (Crucial para TTS/STT)
* Tom: Profissional, prestativo, claro e objetivo. Evite informalidade excessiva, mas seja amigável.
* Concisão: Evite monólogos. Como é uma interação de voz telefônica, mantenha suas respostas em no máximo 2 a 3 frases curtas por turno.
* Pausas Naturais: Interaja com um ritmo natural, não interrompa o usuário e aguarde ele concluir o raciocínio antes de responder.
* Tratamento de Falhas (Falta de Entendimento): Se a transcrição de voz falhar ou você não entender o contexto, não invente informações.
   * Exemplo: "Desculpe, a ligação falhou um pouco e eu não entendi. Você pode repetir, por favor?"`,
  serverSideAI: false,
  autoAnswer: false,
  autoAnswerDelay: 0,
  temperature: 1.0,
  maxDurationMin: 5,
  silenceOperator: false,
  transcribeAudio: true,
  scheduledCalls: "[]",
  firstUtterance: "",
  toolsEnabled: false,
  predefinedTools: ["hangup", "open_ticket", "send_message", "schedule_call"],
  toolPrompts: {
    hangup: "* Ferramenta hangup (Desligar Chamada): Quando a conversa estiver resolvida, o cliente se despedir e não houver mais nenhuma pendência, agradeça pelo contato, despeça-se educadamente e chame a ferramenta hangup para desligar a ligação. Nunca deixe a ligação em silêncio ou pendente após a despedida.",
    open_ticket: "* Ferramenta open_ticket (Abrir Chamado): Use esta ferramenta quando o cliente solicitar falar com um atendente humano, suporte ou precisar de ajuda especializada que a IA não consiga resolver. Pergunte brevemente o motivo do chamado, informe ao cliente que um chamado foi aberto e que um atendente entrará em contato por ligação ou pelo chat, e execute a ferramenta.",
    send_message: "* Ferramenta send_message (Enviar WhatsApp): Use esta ferramenta quando o cliente solicitar que você envie informações por escrito, como um código de barras, chave Pix, link de confirmação, ou endereço. Diga ao cliente: \"Estou te enviando esses dados agora mesmo no seu WhatsApp\" e execute a ferramenta.",
    schedule_call: "* Ferramenta schedule_call (Reagendar/Agendar Ligação): Se o cliente disser que não pode falar no momento, pedir para retornar mais tarde, ou solicitar um lembrete (ex: \"me ligue e confirme a reuniõe as 10 da manhã\"), pergunte educadamente pela data e hora desejada. Calcule a data/hora exata relativa ao horário atual ([today]) e execute esta ferramenta preenchendo o parâmetro 'datetime' em formato ISO e 'prompt' com o roteiro ou lembrete (ex: \"Confirmar reunião\"). Confirme para o cliente o agendamento antes de desligar."
  },
  customTools: [],
  postCall: {
    summaryEnabled: false,
    sendAdmin: false,
    adminNumber: "",
    sendClient: false,
    webhookEnabled: false,
    webhookUrl: "",
  },
  customFields: "",
};

export const AIDialog = ({ sid }: { sid: string }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [tab, setTab] = useState<"config" | "schedules">("config");

  // Estados do formulário da IA
  const [config, setConfig] = useState<AIConfig>({ ...defaultConfig });
  const [schedules, setSchedules] = useState<ScheduledCall[]>([]);

  // Estados para nova ligação agendada
  const [newPhone, setNewPhone] = useState("");
  const [newTime, setNewTime] = useState("");

  useEffect(() => {
    if (!open) return;
    setBusy(true);
    getAIConfig(sid)
      .then((r) => {
        setEnabled(r.enabled);
        const c = r.aiConfig || defaultConfig;
        const mappedPredefined = (c.predefinedTools || []).map((t: string) => t === "human_transfer" ? "open_ticket" : t);
        setConfig({
          serverSideAI: !!c.serverSideAI,
          geminiApiKey: c.geminiApiKey || "",
          voiceName: c.voiceName || "Puck",
          languageCode: c.languageCode || "pt-BR",
          systemInstruction: c.systemInstruction || defaultConfig.systemInstruction,
          autoAnswer: !!c.autoAnswer,
          autoAnswerDelay: c.autoAnswerDelay ?? 0,
          temperature: c.temperature ?? 1.0,
          maxDurationMin: c.maxDurationMin ?? 5,
          silenceOperator: !!c.silenceOperator,
          transcribeAudio: c.transcribeAudio ?? true,
          scheduledCalls: c.scheduledCalls || "[]",
          firstUtterance: c.firstUtterance || "",
          toolsEnabled: !!c.toolsEnabled,
          predefinedTools: mappedPredefined,
          toolPrompts: c.toolPrompts || { ...defaultConfig.toolPrompts },
          customTools: c.customTools || [],
          postCall: c.postCall || { ...defaultConfig.postCall },
          customFields: c.customFields || "",
        });
        try {
          setSchedules(JSON.parse(c.scheduledCalls || "[]"));
        } catch {
          setSchedules([]);
        }
      })
      .catch(() => {
        toast.error("Falha ao carregar as configurações de IA");
      })
      .finally(() => {
        setBusy(false);
      });
  }, [open, sid]);

  const save = async (updatedConfig?: AIConfig) => {
    setBusy(true);
    const target = updatedConfig || config;
    try {
      await setAIConfig(sid, target);
      toast.success("Configuração de IA salva!");
      setEnabled(target.geminiApiKey !== "");
      useAIAgents.getState().setActiveSessionConfig(target);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    setBusy(true);
    try {
      await deleteAIConfig(sid);
      setConfig({ ...defaultConfig });
      setSchedules([]);
      setEnabled(false);
      useAIAgents.getState().setActiveSessionConfig(null);
      toast.success("Integração de IA desabilitada");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleAddSchedule = () => {
    if (!newPhone.trim() || !newTime) {
      toast.error("Preencha o telefone e a hora do agendamento");
      return;
    }
    const cleanPhone = newPhone.replace(/\D/g, "");
    if (cleanPhone.length < 10) {
      toast.error("Telefone inválido");
      return;
    }

    const scheduledDate = new Date(newTime);
    if (scheduledDate <= new Date()) {
      toast.error("Escolha um horário no futuro");
      return;
    }

    const newCall: ScheduledCall = {
      id: Math.random().toString(36).substring(2, 11),
      phone: cleanPhone,
      time: scheduledDate.toISOString(),
      active: true,
    };

    const nextSchedules = [...schedules, newCall];
    setSchedules(nextSchedules);
    const nextConfig = { ...config, scheduledCalls: JSON.stringify(nextSchedules) };
    setConfig(nextConfig);
    void save(nextConfig);

    setNewPhone("");
    setNewTime("");
  };

  const handleDeleteSchedule = (id: string) => {
    const nextSchedules = schedules.filter((s) => s.id !== id);
    setSchedules(nextSchedules);
    const nextConfig = { ...config, scheduledCalls: JSON.stringify(nextSchedules) };
    setConfig(nextConfig);
    void save(nextConfig);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={enabled ? "default" : "outline"} size="sm" className="gap-1.5">
          <Sparkles className="h-4 w-4 text-amber-500 fill-amber-500/20" />
          Configurar IA
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500 fill-amber-500/25" />
            <DialogTitle>Integração de Voz IA (Gemini Live)</DialogTitle>
          </div>
          <DialogDescription>
            Configure um atendente de voz automático utilizando inteligência artificial.
          </DialogDescription>
        </DialogHeader>

        {/* Abas */}
        <div className="flex border-b mt-2">
          <button
            onClick={() => setTab("config")}
            className={`flex-1 pb-2.5 text-sm font-medium border-b-2 text-center transition-colors ${
              tab === "config" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Voz & IA
          </button>
          <button
            onClick={() => setTab("schedules")}
            className={`flex-1 pb-2.5 text-sm font-medium border-b-2 text-center transition-colors ${
              tab === "schedules" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Agendamentos ({schedules.length})
          </button>
        </div>

        <div className={`absolute inset-0 flex items-center justify-center bg-background/50 z-50 transition-all duration-200 ${
          busy ? "opacity-100 visible" : "opacity-0 invisible pointer-events-none"
        }`}>
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>

        <div className="py-4 space-y-4 max-h-[380px] overflow-y-auto pr-1">
          {tab === "config" ? (
            <div className="space-y-4">
              {/* Gemini API Key */}
              <div className="space-y-1.5">
                <Label htmlFor="apiKey">Gemini API Key</Label>
                <Input
                  id="apiKey"
                  type="password"
                  placeholder="Insira sua chave de API Gemini Live"
                  value={config.geminiApiKey}
                  onChange={(e) => setConfig({ ...config, geminiApiKey: e.target.value })}
                />
              </div>

              {/* Voz e Idioma */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="voice">Voz da IA</Label>
                  <select
                    id="voice"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={config.voiceName}
                    onChange={(e) => setConfig({ ...config, voiceName: e.target.value })}
                  >
                    <option value="Puck">Puck (Masculina suave)</option>
                    <option value="Charon">Charon (Masculina grave)</option>
                    <option value="Kore">Kore (Feminina jovem)</option>
                    <option value="Fenrir">Fenrir (Masculina firme)</option>
                    <option value="Aoede">Aoede (Feminina expressiva)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="language">Idioma</Label>
                  <select
                    id="language"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={config.languageCode}
                    onChange={(e) => setConfig({ ...config, languageCode: e.target.value })}
                  >
                    <option value="pt-BR">Português (pt-BR)</option>
                    <option value="en-US">Inglês (en-US)</option>
                    <option value="es-ES">Espanhol (es-ES)</option>
                  </select>
                </div>
              </div>

              {/* Instruções do Sistema */}
              <div className="space-y-1.5">
                <Label htmlFor="instructions">Instruções do Sistema (Prompt)</Label>
                <textarea
                  id="instructions"
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                  placeholder="Ex: Você é o atendente de voz de uma pizzaria. Seja cordial..."
                  value={config.systemInstruction}
                  onChange={(e) => setConfig({ ...config, systemInstruction: e.target.value })}
                />
              </div>

              {/* Primeira Fala da IA */}
              <div className="space-y-1.5">
                <Label htmlFor="firstUtterance">Primeira fala da IA (Atendimento automático/recebidas)</Label>
                <textarea
                  id="firstUtterance"
                  rows={2}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                  placeholder="Ex: Alô? Boa tarde, sou a assistente virtual e estou ligando..."
                  value={config.firstUtterance || ""}
                  onChange={(e) => setConfig({ ...config, firstUtterance: e.target.value })}
                />
              </div>

              {/* Temperatura e Duração Máxima */}
              <div className="grid grid-cols-2 gap-3 items-center">
                <div className="space-y-1">
                  <Label htmlFor="temp">Temperatura ({config.temperature})</Label>
                  <input
                    id="temp"
                    type="range"
                    min="0.2"
                    max="1.8"
                    step="0.1"
                    className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                    value={config.temperature}
                    onChange={(e) => setConfig({ ...config, temperature: parseFloat(e.target.value) })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="duration">Duração Máxima (Minutos)</Label>
                  <Input
                    id="duration"
                    type="number"
                    min="1"
                    max="60"
                    value={config.maxDurationMin}
                    onChange={(e) => setConfig({ ...config, maxDurationMin: parseInt(e.target.value) || 5 })}
                  />
                </div>
              </div>

              {/* Toggles */}
              <div className="border rounded-lg p-3 space-y-3.5 bg-muted/20">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">IA Autônoma no Servidor</Label>
                    <p className="text-xs text-muted-foreground">O servidor gerencia IA e agendamentos sem navegador aberto</p>
                  </div>
                  <Switch
                    checked={config.serverSideAI}
                    onChange={(v) => setConfig({ ...config, serverSideAI: v })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">Atendimento Automático</Label>
                    <p className="text-xs text-muted-foreground">Atender ligações de voz recebidas pela IA</p>
                  </div>
                  <Switch
                    checked={config.autoAnswer}
                    onChange={(v) => setConfig({ ...config, autoAnswer: v })}
                  />
                </div>

                {config.autoAnswer && (
                  <div className="space-y-2 border-l-2 border-primary/20 pl-4 py-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium text-muted-foreground">Tempo de toque antes de atender</Label>
                      <span className="text-xs font-semibold text-primary">
                        {config.autoAnswerDelay === 0 ? "Imediatamente" : `${config.autoAnswerDelay}s`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={60}
                      step={1}
                      value={config.autoAnswerDelay ?? 0}
                      onChange={(e) => setConfig({ ...config, autoAnswerDelay: parseInt(e.target.value) })}
                      className="w-full h-1.5 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary focus:outline-none"
                    />
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">Modo Silencioso do Operador</Label>
                    <p className="text-xs text-muted-foreground">Mutar reprodução de áudio no seu navegador</p>
                  </div>
                  <Switch
                    checked={config.silenceOperator}
                    onChange={(v) => setConfig({ ...config, silenceOperator: v })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">Transcrição em Tempo Real</Label>
                    <p className="text-xs text-muted-foreground">Transcrever diálogos de áudio em texto</p>
                  </div>
                  <Switch
                    checked={config.transcribeAudio}
                    onChange={(v) => setConfig({ ...config, transcribeAudio: v })}
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-2 border-t">
                {enabled && (
                  <Button variant="outline" className="text-destructive hover:bg-destructive/10" onClick={handleDisable}>
                    Desabilitar IA
                  </Button>
                )}
                <Button onClick={() => save()}>Salvar Configuração</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Adicionar agendamento */}
              <div className="border rounded-lg p-3 space-y-3 bg-muted/15">
                <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                  <Plus className="h-3 w-3" /> Programar Ligação Ativa
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">WhatsApp (Telefone)</Label>
                    <Input
                      type="text"
                      placeholder="Ex: 5511999999999"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Data e Hora de Disparo</Label>
                    <Input
                      type="datetime-local"
                      value={newTime}
                      onChange={(e) => setNewTime(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button size="sm" onClick={handleAddSchedule} className="gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    Agendar Ligação
                  </Button>
                </div>
              </div>

              {/* Lista de agendamentos */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" /> Lista de Agendamentos Ativos
                </p>
                <div className="space-y-2">
                  {schedules.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between border rounded-md p-2.5 bg-background shadow-sm hover:border-muted-foreground/30 transition-colors"
                    >
                      <div className="space-y-1 min-w-0">
                        <p className="text-sm font-medium flex items-center gap-1.5">
                          <PhoneCall className="h-3.5 w-3.5 text-muted-foreground" />
                          {s.phone}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(s.time).toLocaleString("pt-BR")}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive h-8 w-8"
                        onClick={() => handleDeleteSchedule(s.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  {schedules.length === 0 && (
                    <p className="text-sm text-center text-muted-foreground py-8 border border-dashed rounded-lg">
                      Nenhuma ligação programada ativa.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
