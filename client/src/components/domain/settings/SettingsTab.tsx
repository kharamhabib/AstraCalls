import { useEffect, useState } from "react";
import { Sparkles, MessageSquare, Settings2, Code, Heart, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getAIConfig, setAIConfig, deleteAIConfig } from "@/services/ai";
import { useAIAgents } from "@/stores/ai";
import type { AIConfig } from "@/types/ai";

import { AISettingsPane } from "./AISettingsPane";
import { ToolsSettingsPane } from "./ToolsSettingsPane";
import { PostCallSettingsPane } from "./PostCallSettingsPane";
import { ChatwootSettingsPane } from "./ChatwootSettingsPane";
import { GeneralSettingsPane } from "./GeneralSettingsPane";

type SubTab = "ai" | "tools" | "post_call" | "chatwoot" | "general";

const subTabs: { id: SubTab; label: string; icon: any }[] = [
  { id: "ai", label: "Voz & IA", icon: Sparkles },
  { id: "tools", label: "Ferramentas", icon: Code },
  { id: "post_call", label: "Pós-Chamada", icon: Heart },
  { id: "chatwoot", label: "Chatwoot", icon: MessageSquare },
  { id: "general", label: "Geral", icon: Settings2 },
];

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
   * Exemplo: "Desculpe, a ligação falhou um pouco e eu não entendi. Você pode repetir, por favor?"

---

### REGRAS PARA O USO DE FERRAMENTAS (APIS):
* Se a ferramenta exigir argumentos (como a mensagem de texto ou número no send_message), extraia-os naturalmente da fala do usuário ou use os valores padrões fornecidos, sem soletrar os parâmetros tecnicamente para o cliente.
* Ferramenta \`send_message\` (Enviar WhatsApp): Use esta ferramenta quando o cliente solicitar que você envie informações por escrito, como um código de barras, chave Pix, link de confirmação, ou endereço. Diga ao cliente: "Estou te enviando esses dados agora mesmo no seu WhatsApp" e execute a ferramenta.
* Ferramenta \`human_transfer\` (Falar com Humano): Se o cliente pedir explicitamente para falar com um atendente humano, gerente, ou se ele fizer perguntas complexas demais que você não sabe responder, diga: "Vou te transferir agora mesmo para um de nossos atendentes, só um momento" e execute a ferramenta imediatamente.
* Ferramenta \`schedule_call\` (Reagendar/Agendar Ligação): Se o cliente disser que não pode falar no momento, pedir para retornar mais tarde, ou solicitar um lembrete (ex: "me ligue e confirme a reunião as 10 da manhã"), pergunte educadamente pela data e hora desejada. Calcule a data/hora exata relativa ao horário atual ([today]) e execute esta ferramenta preenchendo o parâmetro 'datetime' em formato ISO e 'prompt' com o roteiro ou lembrete (ex: "Confirmar reunião"). Confirme para o cliente o agendamento antes de desligar.
* Ferramenta \`hangup\` (Encerrar Chamada): Quando a conversa estiver resolvida, o cliente se despedir e não houver mais nenhuma pendência, agradeça pelo contato, despeça-se educadamente e chame a ferramenta \`hangup\` para desligar a ligação. Nunca deixe a ligação em silêncio ou pendente após a despedida.`,
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
  predefinedTools: ["hangup", "human_transfer", "send_message", "schedule_call"],
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

export const SettingsTab = ({ sid }: { sid: string }) => {
  const [active, setActive] = useState<SubTab>("ai");
  const [aiConfig, setAiConfig] = useState<AIConfig | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBusy(true);
    getAIConfig(sid)
      .then((r) => {
        setEnabled(r.enabled);
        const c = r.aiConfig || defaultConfig;
        setAiConfig({
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
          predefinedTools: c.predefinedTools || [],
          customTools: c.customTools || [],
          postCall: c.postCall || { ...defaultConfig.postCall },
          customFields: c.customFields || "",
        });
      })
      .catch(() => toast.error("Falha ao carregar as configurações de IA"))
      .finally(() => setBusy(false));
  }, [sid]);

  const handleSave = async () => {
    if (!aiConfig) return;
    setBusy(true);
    try {
      await setAIConfig(sid, aiConfig);
      toast.success("Configurações de IA salvas!");
      setEnabled(aiConfig.geminiApiKey !== "");
      useAIAgents.getState().setActiveSessionConfig(aiConfig);
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
      setAiConfig({ ...defaultConfig });
      setEnabled(false);
      useAIAgents.getState().setActiveSessionConfig(null);
      toast.success("Integração de IA desabilitada");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 animate-fade-in relative">
      <div className={`absolute inset-0 flex items-center justify-center bg-background/50 z-50 transition-all duration-200 ${
        busy && !aiConfig ? "opacity-100 visible" : "opacity-0 invisible pointer-events-none"
      }`}>
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>

      <div>
        <h2 className="text-lg font-semibold tracking-tight">Configurações</h2>
        <p className="text-sm text-muted-foreground">
          Gerencie as integrações e preferências desta conta.
        </p>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 rounded-lg bg-muted/40 p-1 flex-wrap">
        {subTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={cn(
                "flex flex-1 min-w-[80px] items-center justify-center gap-1.5 rounded-md px-2.5 py-2 text-xs sm:text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Pane content */}
      <div key={active} className="space-y-5">
        {active === "ai" && aiConfig && (
          <AISettingsPane config={aiConfig} onChange={setAiConfig} enabled={enabled} />
        )}
        {active === "tools" && aiConfig && (
          <ToolsSettingsPane config={aiConfig} onChange={setAiConfig} />
        )}
        {active === "post_call" && aiConfig && (
          <PostCallSettingsPane config={aiConfig} onChange={setAiConfig} />
        )}
        {active === "chatwoot" && <ChatwootSettingsPane sid={sid} />}
        {active === "general" && <GeneralSettingsPane />}

        {/* Master AI Save actions for AI-related panes */}
        {["ai", "tools", "post_call"].includes(active) && aiConfig && (
          <div className="flex gap-2 justify-end pt-3 border-t">
            {enabled && (
              <Button
                variant="outline"
                className="text-destructive hover:bg-destructive/10"
                onClick={handleDisable}
                disabled={busy}
              >
                Desabilitar IA
              </Button>
            )}
            <Button onClick={handleSave} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              <span>Salvar Configurações</span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
