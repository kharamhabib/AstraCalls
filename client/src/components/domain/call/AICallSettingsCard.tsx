import { Sparkles, MessageSquareText } from "lucide-react";
import { cn } from "@/lib/utils";

interface AICallSettingsCardProps {
  useAI: boolean;
  onToggleUseAI: (val: boolean) => void;
  prompt: string;
  onPromptChange: (val: string) => void;
}

export const AICallSettingsCard = ({
  useAI,
  onToggleUseAI,
  prompt,
  onPromptChange,
}: AICallSettingsCardProps) => {
  return (
    <div className="rounded-3xl border bg-card p-5 shadow-xl space-y-4 transition-all h-fit animate-fade-in">
      {/* Header com Toggle */}
      <div className="flex items-center justify-between border-b pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500 font-bold shrink-0">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-sm font-extrabold text-foreground">Ligação por Agente Virtual</h4>
            <p className="text-[11px] text-muted-foreground font-medium">Instruções para o agente nesta chamada</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onToggleUseAI(!useAI)}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
            useAI ? "bg-amber-500" : "bg-muted-foreground/30"
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow-md ring-0 transition duration-200 ease-in-out",
              useAI ? "translate-x-4" : "translate-x-0"
            )}
          />
        </button>
      </div>

      {useAI ? (
        <div className="space-y-4 animate-fade-in text-xs">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-bold text-foreground flex items-center gap-1.5">
                <MessageSquareText className="h-3.5 w-3.5 text-amber-500" />
                <span>Roteiro / Prompt para a ligação:</span>
              </label>
              {prompt && (
                <button
                  type="button"
                  onClick={() => onPromptChange("")}
                  className="text-[10px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
                >
                  Limpar
                </button>
              )}
            </div>

            <textarea
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              placeholder="Ex: Ligar confirmando a reunião de amanhã às 14h com o cliente..."
              rows={4}
              className="w-full rounded-2xl border bg-muted/30 p-3 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-amber-500 focus:bg-background focus:outline-none resize-none transition-all leading-relaxed"
            />
          </div>

          {/* Presets Rápidos */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-wider">Presets Rápidos:</span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => onPromptChange("Ligar confirmando o agendamento de amanhã e perguntar se o cliente tem dúvidas.")}
                className="rounded-xl border bg-muted/20 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground hover:bg-amber-500/10 hover:text-amber-600 hover:border-amber-500/30 transition-all text-left"
              >
                ⚡ Confirmar Agendamento
              </button>
              <button
                type="button"
                onClick={() => onPromptChange("Ligar de forma amigável lembrando sobre a fatura/pendência financeira em aberto.")}
                className="rounded-xl border bg-muted/20 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground hover:bg-amber-500/10 hover:text-amber-600 hover:border-amber-500/30 transition-all text-left"
              >
                ⚡ Lembrete Financeiro
              </button>
              <button
                type="button"
                onClick={() => onPromptChange("Ligar realizando uma pesquisa rápida de satisfação sobre a experiência recebida.")}
                className="rounded-xl border bg-muted/20 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground hover:bg-amber-500/10 hover:text-amber-600 hover:border-amber-500/30 transition-all text-left"
              >
                ⚡ Pesquisa Satisfação
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground italic leading-tight py-2">
          O agente virtual de IA está desativado. As ligações efetuadas serão atendidas manualmente pelo operador via microfone do navegador.
        </p>
      )}
    </div>
  );
};
