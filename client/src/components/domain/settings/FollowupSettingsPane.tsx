import { PhoneMissed, MessageSquare, Clock } from "lucide-react";
import type { AIConfig } from "@/types/ai";

export const FollowupSettingsPane = ({
  config,
  onChange,
}: {
  config: AIConfig;
  onChange: (c: AIConfig) => void;
}) => {
  const followup = config.missedFollowup || {
    enabled: false,
    delaySec: 30,
    messageTemplate: "Olá! Vi que você tentou ligar e não conseguimos atender. Como posso te ajudar?",
  };

  const updateFollowup = (updates: Partial<typeof followup>) => {
    onChange({
      ...config,
      missedFollowup: { ...followup, ...updates },
    });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-card p-5 space-y-4 shadow-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PhoneMissed className="h-5 w-5 text-red-500" />
            <div>
              <h3 className="font-bold text-sm">Follow-up para Chamadas Não Atendidas</h3>
              <p className="text-xs text-muted-foreground">
                Envie uma mensagem automática via WhatsApp quando uma chamada for perdida ou rejeitada.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => updateFollowup({ enabled: !followup.enabled })}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
              followup.enabled ? "bg-primary" : "bg-muted-foreground/30"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow-lg ring-0 transition duration-200 ease-in-out ${
                followup.enabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {followup.enabled && (
          <div className="space-y-4 pt-3 border-t">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-primary" />
                <span>Atraso do Envio (Segundos - Delay Inteligente)</span>
              </label>
              <input
                type="number"
                value={followup.delaySec}
                onChange={(e) => updateFollowup({ delaySec: parseInt(e.target.value) || 0 })}
                className="w-full rounded-xl border bg-background px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-[11px] text-muted-foreground">
                O envio será cancelado automaticamente se o cliente mandar mensagem ou ligar de volta antes do tempo expirar.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5 text-primary" />
                <span>Modelo da Mensagem de Follow-up</span>
              </label>
              <textarea
                rows={3}
                value={followup.messageTemplate}
                onChange={(e) => updateFollowup({ messageTemplate: e.target.value })}
                className="w-full rounded-xl border bg-background p-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
