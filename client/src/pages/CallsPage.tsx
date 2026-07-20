import { useState } from "react";
import { Phone, History, PhoneCall } from "lucide-react";
import { Webphone } from "@/components/domain/call/Webphone";
import { AICallSettingsCard } from "@/components/domain/call/AICallSettingsCard";
import { CallCard } from "@/components/domain/call/CallCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { useHistory } from "@/hooks/useHistory";
import { HistoryItem } from "@/components/domain/history/HistoryDrawer";
import { useCalls } from "@/stores/calls";
import { cn } from "@/lib/utils";

type TabId = "webphone" | "history";

export const CallsPage = ({ sid }: { sid: string }) => {
  const [activeTab, setActiveTab] = useState<TabId>("webphone");
  const [useAI, setUseAI] = useState(true);
  const [prompt, setPrompt] = useState("");

  const calls = useCalls((s) => s.calls);
  const { data: historyRows = [] } = useHistory(sid, activeTab === "history");

  const activeCalls = calls.filter((c) => c.sessionId === sid && c.status !== "ended");

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in">
      {/* Submenu Navigation Pills */}
      <div className="flex items-center gap-2 border-b pb-3">
        <button
          onClick={() => setActiveTab("webphone")}
          className={cn(
            "flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all",
            activeTab === "webphone"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Phone className="h-4 w-4" />
          <span>Webphone & Chamadas Ativas</span>
        </button>

        <button
          onClick={() => setActiveTab("history")}
          className={cn(
            "flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all",
            activeTab === "history"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <History className="h-4 w-4" />
          <span>Histórico & Gravações</span>
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "webphone" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Coluna 1 (Esquerda): Webphone */}
          <div className="lg:col-span-4">
            <Webphone
              sid={sid}
              useAI={useAI}
              prompt={prompt}
            />
          </div>

          {/* Coluna 2 (Meio): Ligação por Agente Virtual */}
          <div className="lg:col-span-4">
            <AICallSettingsCard
              useAI={useAI}
              onToggleUseAI={setUseAI}
              prompt={prompt}
              onPromptChange={setPrompt}
            />
          </div>

          {/* Coluna 3 (Direita): Chamadas em Tempo Real */}
          <div className="lg:col-span-4 space-y-4">
            <h3 className="font-bold text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <PhoneCall className="h-4 w-4 text-primary" />
                <span>Chamadas em Tempo Real</span>
              </span>
              {activeCalls.length > 0 && (
                <span className="rounded-full bg-primary/10 text-primary text-xs font-bold px-2 py-0.5">
                  {activeCalls.length} {activeCalls.length === 1 ? "chamada ativa" : "chamadas ativas"}
                </span>
              )}
            </h3>

            {activeCalls.length > 0 ? (
              <div className="grid grid-cols-1 gap-4">
                {activeCalls.map((c) => (
                  <CallCard key={c.callId} call={c} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<PhoneCall className="h-6 w-6" />}
                title="Nenhuma chamada ativa"
                description="Disque um número no Webphone para iniciar um atendimento."
              />
            )}
          </div>
        </div>
      )}

      {activeTab === "history" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              <span>Histórico Completo ({historyRows.length})</span>
            </h3>
          </div>

          {historyRows.length === 0 ? (
            <EmptyState title="Nenhum histórico encontrado" description="As ligações concluídas ou gravadas aparecerão aqui." />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {historyRows.map((r) => (
                <HistoryItem key={r.callId} sid={sid} row={r} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
