import { useState } from "react";
import { History, PhoneIncoming, PhoneOutgoing, Clock, MessageSquare, ExternalLink, PhoneMissed } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/shared/EmptyState";
import { useHistory } from "@/hooks/useHistory";
import { useContactInfo } from "@/hooks/useContactInfo";
import { AudioRecordingPlayer } from "./AudioRecordingPlayer";
import { TranscriptModal } from "./TranscriptModal";
import type { HistoryRow } from "@/types/history";
import { formatDuration, getInitials, formatPhoneNumber, isCallMissedOrRejected } from "@/utils/format";

export const HistoryItem = ({ sid, row }: { sid: string; row: HistoryRow }) => {
  const [showTranscriptModal, setShowTranscriptModal] = useState(false);
  const { data: contact } = useContactInfo(sid, row.phone);
  const isInbound = row.direction === "inbound";
  const DirIcon = isInbound ? PhoneIncoming : PhoneOutgoing;

  const displayName = row.name || contact?.name || formatPhoneNumber(row.phone);
  const hasContactName = (row.name || contact?.name) && (row.name || contact?.name) !== row.phone;
  const pictureUrl = contact?.pictureUrl;

  const isMissedOrRejected = isCallMissedOrRejected(row.startedAt, row.endedAt, row.endReason);

  let statusBadgeText = isInbound ? "Recebida" : "Efetuada";
  let badgeClass = isInbound ? "bg-secondary text-secondary-foreground" : "bg-primary text-white";

  if (isMissedOrRejected) {
    if (row.endReason === "rejected") {
      statusBadgeText = "Recusada";
      badgeClass = "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30";
    } else {
      statusBadgeText = "Não Atendida";
      badgeClass = "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30";
    }
  }

  return (
    <>
      <li className="rounded-xl border border-primary/10 p-4 transition-all duration-300 hover:shadow-md card-premium space-y-3 animate-fade-in bg-card">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {pictureUrl ? (
              <img
                src={pictureUrl}
                alt={displayName}
                className="h-10 w-10 shrink-0 rounded-full object-cover border border-primary/10 shadow-xs"
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground font-bold text-xs border border-primary/5">
                {getInitials(displayName)}
              </div>
            )}

            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-foreground" title={displayName}>
                {displayName}
              </p>
              {hasContactName && (
                <p className="text-[10px] text-muted-foreground font-mono truncate">
                  {formatPhoneNumber(row.phone)}
                </p>
              )}
              <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground">
                <Clock className="h-3 w-3 text-primary/70 shrink-0" />
                <span>
                  {new Date(row.startedAt).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <Badge className={`text-[9px] px-1.5 h-4.5 font-semibold border ${badgeClass}`}>
              <span className="flex items-center gap-1">
                <DirIcon className="h-2.5 w-2.5" />
                {statusBadgeText}
              </span>
            </Badge>
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
              <Clock className="h-3 w-3 text-muted-foreground/80" />
              {formatDuration(row.startedAt, row.endedAt)}
            </span>
          </div>
        </div>

        {isMissedOrRejected ? (
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-lg w-fit">
            <PhoneMissed className="h-3.5 w-3.5" />
            <span>Chamada não atendida / recusada</span>
          </div>
        ) : (
          <>
            {row.ticketOpened && (
              <div className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400 border border-amber-500/20 break-words leading-relaxed">
                <span className="font-bold flex items-center gap-1 mb-1 text-amber-700 dark:text-amber-300">
                  ⚠️ Chamado Aberto
                </span>
                {row.ticketReason || "Sem motivo especificado pelo cliente."}
              </div>
            )}

            {row.summary && (
              <div className="rounded-xl bg-primary/5 p-3.5 text-xs text-foreground/90 border border-primary/10 whitespace-pre-wrap break-words leading-relaxed font-normal">
                <span className="font-extrabold text-primary block mb-2 pb-1 border-b border-primary/10 text-xs">
                  Resumo do Atendimento:
                </span>
                {row.summary}
              </div>
            )}

            {row.recordingUrl && (
              <div className="pt-1">
                <AudioRecordingPlayer recordingUrl={row.recordingUrl} />
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-all"
                onClick={() => setShowTranscriptModal(true)}
              >
                <MessageSquare className="h-3.5 w-3.5 text-primary" />
                <span>Ver Transcrição</span>
                <ExternalLink className="h-3 w-3 opacity-60 ml-0.5" />
              </Button>
            </div>
          </>
        )}
      </li>

      <TranscriptModal
        sid={sid}
        row={row}
        open={showTranscriptModal}
        onOpenChange={setShowTranscriptModal}
        displayName={displayName}
      />
    </>
  );
};

export const HistoryDrawer = ({ sid }: { sid: string }) => {
  const [open, setOpen] = useState(false);
  const { data: rows = [] } = useHistory(sid, open);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <History className="h-4 w-4" />
          History
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full p-0 sm:max-w-md">
        <SheetHeader className="p-6 pb-4">
          <SheetTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            Histórico de Ligações
          </SheetTitle>
        </SheetHeader>
        <Separator />
        <ScrollArea className="h-[calc(100vh-5.5rem)] px-4 py-4 custom-scrollbar">
          {rows.length === 0 ? (
            <EmptyState title="Nenhuma ligação anterior" description="As chamadas efetuadas ou recebidas aparecerão aqui." />
          ) : (
            <ul className="space-y-3 stagger-children">
              {rows.map((r) => (
                <HistoryItem key={r.callId} sid={sid} row={r} />
              ))}
            </ul>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};
