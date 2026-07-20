import { useState } from "react";
import { History, PhoneIncoming, PhoneOutgoing, Clock, MessageSquare, ExternalLink, PhoneMissed, PhoneOff, Sparkles, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/shared/EmptyState";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useHistory } from "@/hooks/useHistory";
import { useContactInfo } from "@/hooks/useContactInfo";
import { AudioRecordingPlayer } from "./AudioRecordingPlayer";
import { TranscriptModal } from "./TranscriptModal";
import { SummaryModal } from "./SummaryModal";
import { deleteHistoryCall } from "@/services/history";
import type { HistoryRow } from "@/types/history";
import { formatDuration, getInitials, formatPhoneNumber, isCallMissedOrRejected } from "@/utils/format";

export const HistoryItem = ({ sid, row }: { sid: string; row: HistoryRow }) => {
  const [showTranscriptModal, setShowTranscriptModal] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const queryClient = useQueryClient();

  const { data: contact } = useContactInfo(sid, row.phone);
  const isInbound = row.direction === "inbound";
  const DirIcon = isInbound ? PhoneIncoming : PhoneOutgoing;

  const displayName = row.name || contact?.name || formatPhoneNumber(row.phone);
  const hasContactName = (row.name || contact?.name) && (row.name || contact?.name) !== row.phone;
  const pictureUrl = contact?.pictureUrl;

  const isMissedOrRejected = isCallMissedOrRejected(row.startedAt, row.endedAt, row.endReason);

  // Deixa em cima somente se foi Recebida ou Efetuada
  const statusBadgeText = isInbound ? "Recebida" : "Efetuada";
  const badgeClass = isInbound ? "bg-secondary/80 text-secondary-foreground border-secondary/30" : "bg-primary/10 text-primary border-primary/20";

  // Estilização do card baseado no status (cor sutil premium nas bordas/fundo)
  let cardBorderClass = "border-primary/10 bg-card hover:shadow-xs";
  if (row.endReason === "accepted_elsewhere") {
    cardBorderClass = "border-blue-500/20 bg-blue-500/[0.02] hover:border-blue-500/30 hover:shadow-[0_0_8px_rgba(59,130,246,0.05)]";
  } else if (isMissedOrRejected) {
    if (row.endReason === "rejected") {
      cardBorderClass = "border-red-500/20 bg-red-500/[0.02] hover:border-red-500/30 hover:shadow-[0_0_8px_rgba(239,68,68,0.05)]";
    } else {
      cardBorderClass = "border-amber-500/20 bg-amber-500/[0.02] hover:border-amber-500/30 hover:shadow-[0_0_8px_rgba(245,158,11,0.05)]";
    }
  }

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteHistoryCall(sid, row.callId);
      toast.success("Chamada excluída do histórico com sucesso!");
      queryClient.invalidateQueries({ queryKey: ["history", sid] });
      setShowDeleteConfirm(false);
    } catch (err: any) {
      toast.error(err.message || "Erro ao excluir chamada.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <li className={`flex flex-col justify-between h-full rounded-lg border p-3.5 transition-all duration-300 animate-fade-in ${cardBorderClass}`}>
        <div className="flex-1 flex flex-col justify-between gap-3">
          <div className="space-y-2.5">
            {/* Top header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {pictureUrl ? (
                  <img
                    src={pictureUrl}
                    alt={displayName}
                    className="h-9 w-9 shrink-0 rounded-full object-cover border border-primary/10 shadow-xs"
                  />
                ) : (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground font-bold text-xs border border-primary/5">
                    {getInitials(displayName)}
                  </div>
                )}

                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-foreground leading-snug" title={displayName}>
                    {displayName}
                  </p>
                  {hasContactName && (
                    <p className="text-[10px] text-muted-foreground font-mono truncate leading-none mt-0.5">
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

              <div className="flex flex-col items-end gap-1 shrink-0">
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className={`text-[9px] px-1.5 h-4.5 font-semibold rounded-md ${badgeClass}`}>
                    <span className="flex items-center gap-1">
                      <DirIcon className="h-2.5 w-2.5" />
                      {statusBadgeText}
                    </span>
                  </Badge>

                  {/* Lixeira de exclusão no topo */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDeleteConfirm(true);
                    }}
                    className="text-muted-foreground hover:text-red-500 hover:bg-red-500/10 p-1 rounded-md transition-all duration-200"
                    title="Excluir chamada"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium pr-1">
                  <Clock className="h-3 w-3 text-muted-foreground/60" />
                  {formatDuration(row.startedAt, row.endedAt)}
                </span>
              </div>
            </div>

            {/* Informação elegante do status de chamada não atendida ou recusada diretamente no corpo do card */}
            {row.endReason === "accepted_elsewhere" ? (
              <div className="flex items-center gap-1 text-[10px] font-bold text-blue-600 dark:text-blue-400 mt-1 pl-1">
                <PhoneMissed className="h-3 w-3 rotate-180 shrink-0" />
                <span>Atendida em outro dispositivo</span>
              </div>
            ) : isMissedOrRejected ? (
              <div className={`flex items-center gap-1 text-[10px] font-bold mt-1 pl-1 ${
                row.endReason === "rejected"
                  ? "text-red-600 dark:text-red-400"
                  : "text-amber-600 dark:text-amber-400"
              }`}>
                {row.endReason === "rejected" ? <PhoneOff className="h-3 w-3 shrink-0" /> : <PhoneMissed className="h-3 w-3 shrink-0" />}
                <span>
                  {row.endReason === "rejected"
                    ? (isInbound ? "Você recusou a chamada" : "O cliente recusou a chamada")
                    : (isInbound ? "Chamada recebida não atendida" : "O cliente não atendeu")}
                </span>
              </div>
            ) : null}

            {row.ticketOpened && (
              <div className="rounded-md bg-amber-500/5 p-2 text-[11px] text-amber-600 dark:text-amber-400 border border-amber-500/10 break-words leading-normal">
                <span className="font-bold flex items-center gap-1 mb-0.5 text-amber-700 dark:text-amber-300">
                  ⚠️ Chamado Aberto
                </span>
                {row.ticketReason || "Sem motivo especificado."}
              </div>
            )}
          </div>

          {/* Gravação e botões de ação (exibidos apenas se a chamada foi atendida) */}
          {!isMissedOrRejected && (
            <div className="space-y-2 pt-0.5">
              {row.recordingUrl && (
                <div>
                  <AudioRecordingPlayer recordingUrl={row.recordingUrl} />
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6.5 text-[10px] gap-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-primary/5 transition-all px-2.5"
                  onClick={() => setShowTranscriptModal(true)}
                >
                  <MessageSquare className="h-3 w-3 text-primary" />
                  <span>Ver Transcrição</span>
                  <ExternalLink className="h-2.5 w-2.5 opacity-60 ml-0.5" />
                </Button>

                {row.summary && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6.5 text-[10px] gap-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-primary/5 transition-all px-2.5"
                    onClick={() => setShowSummaryModal(true)}
                  >
                    <Sparkles className="h-3 w-3 text-primary animate-pulse" />
                    <span>Ver Resumo</span>
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </li>

      <TranscriptModal
        sid={sid}
        row={row}
        open={showTranscriptModal}
        onOpenChange={setShowTranscriptModal}
        displayName={displayName}
      />

      <SummaryModal
        row={row}
        open={showSummaryModal}
        onOpenChange={setShowSummaryModal}
        displayName={displayName}
      />

      {/* Modal de Confirmação de Exclusão */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="max-w-sm rounded-lg p-5 gap-4 shadow-2xl border bg-card text-card-foreground">
          <DialogHeader className="space-y-2 pb-2 border-b">
            <DialogTitle className="text-sm font-bold text-foreground flex items-center gap-2">
              <Trash2 className="h-4.5 w-4.5 text-red-500 shrink-0" />
              <span>Excluir chamada do histórico?</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground leading-normal">
              Esta ação excluirá permanentemente esta chamada do banco de dados, incluindo a gravação de áudio, transcrições e resumos correspondentes. Esta ação é irreversível.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs rounded-md"
              onClick={() => setShowDeleteConfirm(false)}
              disabled={isDeleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="h-7 text-xs rounded-md gap-1"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Excluindo..." : "Sim, Excluir"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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
