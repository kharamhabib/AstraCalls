import { Star, MessageSquare, ShieldAlert } from "lucide-react";
import type { AIConfig } from "@/types/ai";
import { NPSDashboard } from "@/components/domain/nps/NPSDashboard";

export const NPSSettingsPane = ({
  sid,
  config,
  onChange,
}: {
  sid: string;
  config: AIConfig;
  onChange: (c: AIConfig) => void;
}) => {
  const nps = config.nps || {
    enabled: false,
    delaySec: 300,
    minCallDuration: 30,
    supervisorPhone: "",
    messageTemplate: "Em uma escala de 0 a 10, como você avalia o nosso atendimento de hoje?",
  };

  const updateNPS = (updates: Partial<typeof nps>) => {
    onChange({
      ...config,
      nps: { ...nps, ...updates },
    });
  };

  return (
    <div className="space-y-6">
      {/* NPS Settings Controls */}
      <div className="rounded-2xl border bg-card p-5 space-y-4 shadow-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Star className="h-5 w-5 text-amber-500" />
            <div>
              <h3 className="font-bold text-sm">Pesquisa NPS Pós-Chamada</h3>
              <p className="text-xs text-muted-foreground">
                Envie automaticamente uma pesquisa de satisfação por WhatsApp após o encerramento da ligação.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => updateNPS({ enabled: !nps.enabled })}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
              nps.enabled ? "bg-primary" : "bg-muted-foreground/30"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow-lg ring-0 transition duration-200 ease-in-out ${
                nps.enabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {nps.enabled && (
          <div className="space-y-4 pt-3 border-t">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Atraso do Envio (Segundos)</label>
                <input
                  type="number"
                  value={nps.delaySec}
                  onChange={(e) => updateNPS({ delaySec: parseInt(e.target.value) || 0 })}
                  className="w-full rounded-xl border bg-background px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Duração Mínima da Chamada (Segundos)</label>
                <input
                  type="number"
                  value={nps.minCallDuration}
                  onChange={(e) => updateNPS({ minCallDuration: parseInt(e.target.value) || 0 })}
                  className="w-full rounded-xl border bg-background px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5 text-red-500" />
                <span>Telefone do Supervisor para Alerta Detrator (Notas 0-6)</span>
              </label>
              <input
                type="text"
                value={nps.supervisorPhone}
                onChange={(e) => updateNPS({ supervisorPhone: e.target.value })}
                placeholder="Ex: 5511999999999"
                className="w-full rounded-xl border bg-background px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5 text-primary" />
                <span>Modelo da Mensagem do NPS</span>
              </label>
              <textarea
                rows={2}
                value={nps.messageTemplate}
                onChange={(e) => updateNPS({ messageTemplate: e.target.value })}
                className="w-full rounded-xl border bg-background p-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
        )}
      </div>

      {/* NPS Dashboard Component */}
      <NPSDashboard sid={sid} />
    </div>
  );
};
