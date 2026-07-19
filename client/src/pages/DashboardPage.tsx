import { useEffect, useState } from "react";
import {
  Phone,
  PhoneMissed,
  Clock,
  Star,
  ArrowUpRight,
  Ticket,
  Calendar,
  Sparkles,
  MessageSquare,
  Radio,
  PhoneIncoming,
  PhoneOutgoing,
} from "lucide-react";
import { useNavigation } from "@/stores/navigation";
import { useSessions } from "@/stores/sessions";
import { useCalls } from "@/stores/calls";
import { useHistory } from "@/hooks/useHistory";
import { getNPSSummary, getAIConfig } from "@/services/ai";
import { parseScheduledCalls } from "@/lib/ai/scheduled-calls";
import type { NPSSummary, ScheduledCall } from "@/types/ai";
import type { HistoryRow } from "@/types/history";
import { AudioRecordingPlayer } from "@/components/domain/history/AudioRecordingPlayer";
import { TranscriptModal } from "@/components/domain/history/TranscriptModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPhoneNumber } from "@/utils/format";
import { cn } from "@/lib/utils";

function formatDurationSecs(secs: number): string {
  if (secs <= 0) return "00:00";
  const mins = Math.floor(secs / 60);
  const remainSecs = Math.floor(secs % 60);
  return `${mins.toString().padStart(2, "0")}:${remainSecs.toString().padStart(2, "0")}`;
}

export const DashboardPage = ({ sid }: { sid: string }) => {
  const { agentStatus, setAgentStatus, setActiveSection } = useNavigation();
  const sessions = useSessions((s) => s.sessions);
  const activeCallsStore = useCalls((s) => s.calls);
  
  const { data: historyRows = [] } = useHistory(sid, true);
  const [npsData, setNpsData] = useState<NPSSummary | null>(null);
  const [upcomingSchedules, setUpcomingSchedules] = useState<ScheduledCall[]>([]);
  const [selectedTranscriptRow, setSelectedTranscriptRow] = useState<HistoryRow | null>(null);

  const activeSession = sessions.find((s) => s.id === sid);

  // Busca dados de NPS e Agendamentos
  useEffect(() => {
    if (!sid) return;
    getNPSSummary(sid)
      .then((r) => setNpsData(r.summary))
      .catch(() => {});

    getAIConfig(sid)
      .then((r) => {
        if (r.aiConfig?.scheduledCalls) {
          const all = parseScheduledCalls(r.aiConfig.scheduledCalls);
          const pending = all
            .filter((s) => s.active && new Date(s.time) > new Date())
            .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
          setUpcomingSchedules(pending);
        }
      })
      .catch(() => {});
  }, [sid]);

  // Cálculos de Estatísticas Reais baseados no Histórico
  const todayStr = new Date().toDateString();
  const todayHistory = historyRows.filter(
    (r) => new Date(r.startedAt).toDateString() === todayStr,
  );
  
  const todayCallsCount = todayHistory.length;
  
  const answeredCalls = todayHistory.filter((r) => {
    const duration = (r.endedAt ?? r.startedAt) - r.startedAt;
    return r.endedAt && duration >= 3000 && r.endReason !== "rejected" && r.endReason !== "no_answer" && r.endReason !== "timeout";
  });

  const missedCallsCount = todayHistory.filter((r) => {
    const duration = (r.endedAt ?? r.startedAt) - r.startedAt;
    if (r.endReason === "rejected" || r.endReason === "no_answer" || r.endReason === "timeout" || r.endReason === "canceled") return true;
    if (!r.endedAt || duration < 3000) return true;
    return false;
  }).length;

  const totalSecsAnswered = answeredCalls.reduce(
    (acc, r) => acc + Math.floor(((r.endedAt ?? r.startedAt) - r.startedAt) / 1000),
    0,
  );
  const avgDurationSecs = answeredCalls.length > 0 ? Math.round(totalSecsAnswered / answeredCalls.length) : 0;
  
  const openTicketsCount = todayHistory.filter((r) => r.ticketOpened).length;
  
  const activeRealtimeCalls = activeCallsStore.filter((c) => c.sessionId === sid && c.status !== "ended");

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-fade-in">
      {/* Top Banner & Status Selector */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border bg-card p-5 shadow-xs">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold tracking-tight text-foreground">Painel do Agente</h1>
            {activeRealtimeCalls.length > 0 && (
              <span className="rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-extrabold px-2.5 py-0.5 animate-pulse">
                {activeRealtimeCalls.length} {activeRealtimeCalls.length === 1 ? "chamada em andamento" : "chamadas em andamento"}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Visão geral do seu atendimento PABX e performance de IA em tempo real</p>
        </div>

        {/* Status Selector Pills */}
        <div className="flex items-center gap-1.5 rounded-xl border bg-muted/40 p-1">
          <button
            onClick={() => setAgentStatus("available")}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
              agentStatus === "available"
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shadow-xs font-bold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Disponível</span>
          </button>

          <button
            onClick={() => setAgentStatus("busy")}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
              agentStatus === "busy"
                ? "bg-red-500/15 text-red-600 dark:text-red-400 shadow-xs font-bold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="h-2 w-2 rounded-full bg-red-500" />
            <span>Ocupado</span>
          </button>

          <button
            onClick={() => setAgentStatus("paused")}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
              agentStatus === "paused"
                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 shadow-xs font-bold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span>Em Pausa</span>
          </button>
        </div>
      </div>

      {/* Real-time KPI Metrics Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {/* Chamadas Hoje */}
        <div className="rounded-2xl border bg-card p-4.5 shadow-xs transition-all hover:shadow-md space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Chamadas Hoje</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Phone className="h-4 w-4" />
            </span>
          </div>
          <p className="text-2xl font-extrabold text-foreground">{todayCallsCount}</p>
          <p className="text-[10px] text-muted-foreground font-medium">
            {answeredCalls.length} atendidas / {todayCallsCount - answeredCalls.length} sem resposta
          </p>
        </div>

        {/* Perdidas / Rejeitadas */}
        <div className="rounded-2xl border bg-card p-4.5 shadow-xs transition-all hover:shadow-md space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Perdidas / Rejeitadas</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-red-500/10 text-red-500">
              <PhoneMissed className="h-4 w-4" />
            </span>
          </div>
          <p className="text-2xl font-extrabold text-red-500">{missedCallsCount}</p>
          <p className="text-[10px] text-muted-foreground font-medium">
            {todayCallsCount > 0 ? `${Math.round((missedCallsCount / todayCallsCount) * 100)}% de não atendimentos` : "Sem perdas hoje"}
          </p>
        </div>

        {/* Duração Média (TMA) */}
        <div className="rounded-2xl border bg-card p-4.5 shadow-xs transition-all hover:shadow-md space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Duração Média</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500">
              <Clock className="h-4 w-4" />
            </span>
          </div>
          <p className="text-2xl font-extrabold text-foreground">{formatDurationSecs(avgDurationSecs)}</p>
          <p className="text-[10px] text-muted-foreground font-medium">Tempo médio de atendimento (TMA)</p>
        </div>

        {/* NPS Score */}
        <div className="rounded-2xl border bg-card p-4.5 shadow-xs transition-all hover:shadow-md space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">NPS Score</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
              <Star className="h-4 w-4" />
            </span>
          </div>
          <p className="text-2xl font-extrabold text-amber-500">
            {npsData && npsData.total > 0 ? `${Math.round(npsData.npsScore)}%` : "N/A"}
          </p>
          <p className="text-[10px] text-muted-foreground font-medium">
            {npsData && npsData.total > 0 ? `${npsData.total} avaliações recebidas` : "Aguardando pesquisas"}
          </p>
        </div>

        {/* Chamados Abertos */}
        <div className="rounded-2xl border bg-card p-4.5 shadow-xs transition-all hover:shadow-md space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Chamados Abertos</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange-500/10 text-orange-500">
              <Ticket className="h-4 w-4" />
            </span>
          </div>
          <p className="text-2xl font-extrabold text-orange-500">{openTicketsCount}</p>
          <p className="text-[10px] text-muted-foreground font-medium">Transbordo para suporte humano</p>
        </div>
      </div>

      {/* Main Grid: Recent Calls List & Right Sidebar */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left 8 cols: Últimas Chamadas Realizadas */}
        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <Phone className="h-4 w-4 text-primary" />
              <span>Últimos Atendimentos Realizados</span>
            </h3>

            <button
              onClick={() => setActiveSection("calls")}
              className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              <span>Ver Histórico Completo</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {historyRows.length === 0 ? (
            <div className="rounded-2xl border bg-card p-8 text-center text-muted-foreground space-y-2">
              <Phone className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <p className="text-xs font-semibold">Nenhuma chamada registrada recentemente.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {historyRows.slice(0, 5).map((r) => {
                const isInbound = r.direction === "inbound";
                const DirIcon = isInbound ? PhoneIncoming : PhoneOutgoing;
                const formattedPhone = formatPhoneNumber(r.phone);
                const displayName = r.name || formattedPhone;

                const durationMs = (r.endedAt ?? r.startedAt) - r.startedAt;
                const isMissedOrRejected =
                  r.endReason === "rejected" ||
                  r.endReason === "no_answer" ||
                  r.endReason === "timeout" ||
                  r.endReason === "canceled" ||
                  !r.endedAt ||
                  durationMs < 3000;

                let statusBadgeText = isInbound ? "Recebida" : "Efetuada";
                let badgeClass = isInbound
                  ? "bg-secondary text-secondary-foreground"
                  : "bg-primary text-primary-foreground";

                if (isMissedOrRejected) {
                  if (r.endReason === "rejected") {
                    statusBadgeText = "Recusada";
                    badgeClass = "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30";
                  } else {
                    statusBadgeText = "Não Atendida";
                    badgeClass = "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30";
                  }
                }

                return (
                  <div
                    key={r.callId}
                    className="rounded-2xl border bg-card p-4 shadow-xs transition-all hover:shadow-md space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary font-bold text-xs border border-primary/20">
                          {displayName.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0 space-y-0.5">
                          <h4 className="font-extrabold text-sm truncate" title={displayName}>
                            {displayName}
                          </h4>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                            <span>{formattedPhone}</span>
                            <span>•</span>
                            <span>
                              {new Date(r.startedAt).toLocaleString("pt-BR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Badge className={cn("h-5 text-[10px] font-bold border", badgeClass)}>
                          <DirIcon className="h-3 w-3 mr-1" />
                          {statusBadgeText}
                        </Badge>

                        {!isMissedOrRejected && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedTranscriptRow(r)}
                            className="h-7 text-xs gap-1 rounded-xl"
                          >
                            <MessageSquare className="h-3.5 w-3.5 text-primary" />
                            <span className="hidden sm:inline">Transcrição</span>
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Exibe aviso de chamada recusada / não atendida se for o caso */}
                    {isMissedOrRejected ? (
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-xl w-fit">
                        <PhoneMissed className="h-3.5 w-3.5" />
                        <span>Chamada não atendida / recusada pelo destinatário</span>
                      </div>
                    ) : (
                      <>
                        {/* Resumo da IA no Card se atendida e disponível */}
                        {r.summary && (
                          <div className="rounded-xl bg-primary/5 p-3 text-xs text-foreground/90 border border-primary/10 whitespace-pre-wrap break-words leading-relaxed">
                            <span className="font-extrabold text-primary block mb-1">Resumo IA:</span>
                            {r.summary}
                          </div>
                        )}

                        {/* Audio Player do Servidor se gravado */}
                        {r.recordingUrl && (
                          <div className="pt-1">
                            <AudioRecordingPlayer recordingUrl={r.recordingUrl} />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right 4 cols: Account Connection & Upcoming IA Schedules */}
        <div className="lg:col-span-4 space-y-5">
          {/* Status da Conexão Ativa */}
          <div className="rounded-2xl border bg-card p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm">Status da Conexão</h3>
              <button
                onClick={() => setActiveSection("connections")}
                className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                <Radio className="h-3.5 w-3.5" />
                <span>Gerenciar</span>
              </button>
            </div>

            {activeSession ? (
              <div className="rounded-xl border bg-muted/20 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs truncate max-w-[150px]">{activeSession.name}</span>
                  <span className="flex items-center gap-1.5 text-xs font-bold">
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        activeSession.state === "open"
                          ? "bg-emerald-500 animate-pulse"
                          : activeSession.state === "qr"
                          ? "bg-amber-500"
                          : "bg-red-500",
                      )}
                    />
                    <span className="capitalize text-[11px]">
                      {activeSession.state === "open" ? "Online" : activeSession.state === "qr" ? "Aguardando QR" : "Desconectado"}
                    </span>
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground font-mono truncate">{activeSession.jid || "Sem JID"}</p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground py-2 text-center">Nenhuma sessão selecionada.</p>
            )}
          </div>

          {/* Próximos Agendamentos da IA */}
          <div className="rounded-2xl border bg-card p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-primary" />
                <span>Próximos Agendamentos IA</span>
              </h3>
              <button
                onClick={() => setActiveSection("schedules")}
                className="text-xs font-semibold text-primary hover:underline"
              >
                <span>Ver Todos</span>
              </button>
            </div>

            {upcomingSchedules.length === 0 ? (
              <div className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground space-y-1">
                <Sparkles className="h-4 w-4 text-amber-500 mx-auto" />
                <p className="font-medium">Nenhum agendamento pendente.</p>
                <p className="text-[10px]">A IA agendará automaticamente quando solicitado pelos clientes.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {upcomingSchedules.slice(0, 3).map((item) => (
                  <div key={item.id} className="rounded-xl border bg-amber-500/5 p-3 space-y-1 text-xs">
                    <div className="flex items-center justify-between font-bold">
                      <span className="font-mono text-foreground">{formatPhoneNumber(item.phone)}</span>
                      <span className="text-[10px] text-amber-600 dark:text-amber-400">
                        {new Date(item.time).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    {item.prompt && <p className="text-[11px] text-muted-foreground truncate">{item.prompt}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal de Transcrição Completa */}
      {selectedTranscriptRow && (
        <TranscriptModal
          sid={sid}
          row={selectedTranscriptRow}
          open={!!selectedTranscriptRow}
          onOpenChange={(open) => !open && setSelectedTranscriptRow(null)}
          displayName={selectedTranscriptRow.name || formatPhoneNumber(selectedTranscriptRow.phone)}
        />
      )}
    </div>
  );
};
