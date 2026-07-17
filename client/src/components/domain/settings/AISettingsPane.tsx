import { Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import type { AIConfig } from "@/types/ai";
import { Switch } from "@/components/ui/Switch";

interface AISettingsPaneProps {
  config: AIConfig;
  onChange: (cfg: AIConfig) => void;
  enabled: boolean;
}

export const AISettingsPane = ({ config, onChange, enabled }: AISettingsPaneProps) => {
  return (
    <div className="space-y-5 animate-fade-in">
      {/* Status indicator */}
      <div className="flex items-center gap-2 px-1">
        <Sparkles className="h-4 w-4 text-warning-text fill-warning/20" />
        <span className="text-sm font-medium">
          Integração de Voz IA (Gemini Live)
        </span>
        <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${
          enabled ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
        }`}>
          {enabled ? "Ativa" : "Inativa"}
        </span>
      </div>

      {/* API Key */}
      <Card className="card-premium">
        <CardContent className="p-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="apiKey">Gemini API Key</Label>
            <Input
              id="apiKey"
              type="password"
              placeholder="Insira sua chave de API Gemini Live"
              value={config.geminiApiKey}
              onChange={(e) => onChange({ ...config, geminiApiKey: e.target.value })}
            />
          </div>

          {/* Voice & Language */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="voice">Voz da IA</Label>
              <select
                id="voice"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={config.voiceName}
                onChange={(e) => onChange({ ...config, voiceName: e.target.value })}
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
                onChange={(e) => onChange({ ...config, languageCode: e.target.value })}
              >
                <option value="pt-BR">Português (pt-BR)</option>
                <option value="en-US">Inglês (en-US)</option>
                <option value="es-ES">Espanhol (es-ES)</option>
              </select>
            </div>
          </div>

          {/* System Instructions */}
          <div className="space-y-1.5">
            <Label htmlFor="instructions">Instruções do Sistema (Prompt)</Label>
            <textarea
              id="instructions"
              rows={8}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y min-h-[180px]"
              placeholder="Ex: Você é o atendente de voz de uma pizzaria. Seja cordial..."
              value={config.systemInstruction}
              onChange={(e) => onChange({ ...config, systemInstruction: e.target.value })}
            />
            <div className="rounded-md bg-muted/40 p-2.5 text-xs space-y-1 text-muted-foreground animate-fade-in-fast border border-border/50">
              <p className="font-semibold text-foreground">Tags Dinâmicas Disponíveis:</p>
              <ul className="list-disc list-inside space-y-0.5 mt-1 font-sans">
                <li><code className="text-primary font-mono">[today]</code>: Substitui por data e hora atual (ex: 29/06/2026 23:48).</li>
                <li><code className="text-primary font-mono">[phone]</code>: Número de telefone do cliente.</li>
                <li><code className="text-primary font-mono">[direction]</code>: Sentido da chamada (inbound/outbound).</li>
                <li><code className="text-primary font-mono">[session_name]</code>: Nome da sessão ativa.</li>
                <li><code className="text-primary font-mono">[custom_fields]</code>: Conteúdo do campo personalizado abaixo.</li>
              </ul>
            </div>
          </div>

          {/* Custom Fields */}
          <div className="space-y-1.5">
            <Label htmlFor="customFields">Campos Personalizados (Tag [custom_fields])</Label>
            <textarea
              id="customFields"
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
              placeholder="Ex: Nome da pizzaria: Pizza Top, Gerente: João, Cidade: São Paulo"
              value={config.customFields || ""}
              onChange={(e) => onChange({ ...config, customFields: e.target.value })}
            />
          </div>

          {/* First Utterance */}
          <div className="space-y-1.5">
            <Label htmlFor="firstUtterance">Primeira fala da IA (Atendimento automático/recebidas)</Label>
            <textarea
              id="firstUtterance"
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
              placeholder="Ex: Alô? Boa tarde, sou a assistente virtual e estou ligando..."
              value={config.firstUtterance || ""}
              onChange={(e) => onChange({ ...config, firstUtterance: e.target.value })}
            />
          </div>

          {/* Temperature & Duration */}
          <div className="grid grid-cols-2 gap-3 items-center">
            <div className="space-y-1.5">
              <Label htmlFor="temp">Temperatura ({config.temperature})</Label>
              <input
                id="temp"
                type="range"
                min="0.2"
                max="1.8"
                step="0.1"
                className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                value={config.temperature}
                onChange={(e) => onChange({ ...config, temperature: parseFloat(e.target.value) })}
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
                onChange={(e) => onChange({ ...config, maxDurationMin: parseInt(e.target.value) || 5 })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Toggles */}
      <Card className="card-premium">
        <CardContent className="p-4 space-y-4">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Comportamento
          </h3>
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium cursor-pointer" htmlFor="serverSideAI">IA Autônoma no Servidor</Label>
                <p className="text-xs text-muted-foreground">O servidor gerencia IA e agendamentos sem necessidade do navegador aberto</p>
              </div>
              <Switch id="serverSideAI" checked={config.serverSideAI} onChange={(v) => onChange({ ...config, serverSideAI: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium cursor-pointer" htmlFor="autoAnswer">Atendimento Automático</Label>
                <p className="text-xs text-muted-foreground">Atender ligações de voz recebidas pela IA</p>
              </div>
              <Switch id="autoAnswer" checked={config.autoAnswer} onChange={(v) => onChange({ ...config, autoAnswer: v })} />
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
                  onChange={(e) => onChange({ ...config, autoAnswerDelay: parseInt(e.target.value) })}
                  className="w-full h-1.5 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary focus:outline-none"
                />
              </div>
            )}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium cursor-pointer" htmlFor="silenceOperator">Modo Silencioso do Operador</Label>
                <p className="text-xs text-muted-foreground">Mutar reprodução de áudio no seu navegador</p>
              </div>
              <Switch id="silenceOperator" checked={config.silenceOperator} onChange={(v) => onChange({ ...config, silenceOperator: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium cursor-pointer" htmlFor="transcribeAudio">Transcrição em Tempo Real</Label>
                <p className="text-xs text-muted-foreground">Transcrever diálogos de áudio em texto</p>
              </div>
              <Switch id="transcribeAudio" checked={config.transcribeAudio} onChange={(v) => onChange({ ...config, transcribeAudio: v })} />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
