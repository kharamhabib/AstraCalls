import { useRef, useEffect, useState } from "react";
import { MessageSquare, Sparkles, Copy, Check, PhoneIncoming, PhoneOutgoing, Clock, User, Bot } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTranscript } from "@/hooks/useHistory";
import { toast } from "sonner";
import type { HistoryRow } from "@/types/history";
import { formatPhoneNumber } from "@/utils/format";
import { cn } from "@/lib/utils";

interface TranscriptModalProps {
  sid: string;
  row: HistoryRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayName: string;
}

function formatDuration(startedAt: number, endedAt: number | null): string {
  if (!endedAt) return "Em andamento";
  const secs = Math.floor((endedAt - startedAt) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remainSecs}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

export const TranscriptModal = ({ sid, row, open, onOpenChange, displayName }: TranscriptModalProps) => {
  const { data: transcript = [], isLoading, error } = useTranscript(sid, row.callId, open);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isInbound = row.direction === "inbound";
  const DirIcon = isInbound ? PhoneIncoming : PhoneOutgoing;

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, transcript]);

  const handleCopy = () => {
    if (transcript.length === 0) return;
    const text = transcript
      .map((t) => `${t.speaker === "ai" ? "IA" : "Cliente"}: ${t.text}`)
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Transcrição copiada para a área de transferência!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl sm:max-w-xl rounded-2xl p-6 gap-4 shadow-2xl border bg-card text-card-foreground animate-scale-in">
        {/* Modal Header */}
        <DialogHeader className="space-y-3 pb-3 border-b">
          <div className="flex items-start justify-between gap-3 pr-6">
            <div className="space-y-1 min-w-0">
              <DialogTitle className="text-lg font-extrabold flex items-center gap-2 text-foreground">
                <MessageSquare className="h-5 w-5 text-primary shrink-0" />
                <span className="truncate">{displayName}</span>
              </DialogTitle>
              <DialogDescription className="text-xs font-mono text-muted-foreground truncate">
                {formatPhoneNumber(row.phone)}
              </DialogDescription>
            </div>

            {/* Badges */}
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant={isInbound ? "secondary" : "default"} className="h-6 text-xs px-2.5 font-bold rounded-lg">
                <DirIcon className="h-3 w-3 mr-1" />
                {isInbound ? "Recebida" : "Efetuada"}
              </Badge>
              <Badge variant="outline" className="h-6 text-xs px-2.5 font-bold rounded-lg">
                <Clock className="h-3 w-3 mr-1 text-muted-foreground" />
                {formatDuration(row.startedAt, row.endedAt)}
              </Badge>
            </div>
          </div>

          {/* Subheader info & Actions */}
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
            <span>
              Data:{" "}
              <strong className="text-foreground font-semibold">
                {new Date(row.startedAt).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </strong>
            </span>

            {transcript.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                className="h-7 text-xs gap-1.5 rounded-lg hover:bg-primary/10"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? "Copiado!" : "Copiar Transcrição"}</span>
              </Button>
            )}
          </div>
        </DialogHeader>

        {/* Modal Body: Scrollable Conversation Stream */}
        <div
          ref={scrollRef}
          className="max-h-[60vh] min-h-[220px] overflow-y-auto custom-scrollbar p-1 space-y-3"
        >
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground space-y-2 animate-pulse">
              <Sparkles className="h-6 w-6 text-primary animate-spin" />
              <p className="text-xs font-semibold">Carregando transcrição da chamada...</p>
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-destructive/10 p-4 text-center text-xs text-destructive font-semibold border border-destructive/20">
              Não foi possível carregar a transcrição desta chamada.
            </div>
          )}

          {!isLoading && !error && transcript.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground space-y-2 text-center">
              <MessageSquare className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-xs font-semibold">Nenhuma transcrição gravada para esta ligação.</p>
            </div>
          )}

          {!isLoading &&
            !error &&
            transcript.length > 0 &&
            transcript.map((line, idx) => {
              const isAi = line.speaker === "ai";
              return (
                <div
                  key={idx}
                  className={cn(
                    "flex flex-col gap-1 w-full animate-fade-in",
                    isAi ? "items-start" : "items-end",
                  )}
                >
                  <span className="flex items-center gap-1 text-[10px] font-extrabold uppercase text-muted-foreground px-1">
                    {isAi ? (
                      <>
                        <Bot className="h-3 w-3 text-primary" />
                        <span>IA (Assistente)</span>
                      </>
                    ) : (
                      <>
                        <User className="h-3 w-3 text-emerald-500" />
                        <span>Cliente</span>
                      </>
                    )}
                  </span>

                  <div
                    className={cn(
                      "rounded-2xl px-4 py-2.5 text-xs shadow-xs max-w-[85%] leading-relaxed border break-words font-medium",
                      isAi
                        ? "bg-primary/10 text-foreground border-primary/20 rounded-tl-none"
                        : "bg-emerald-500/10 text-foreground border-emerald-500/20 rounded-tr-none",
                    )}
                  >
                    {line.text}
                  </div>
                </div>
              );
            })}
        </div>
      </DialogContent>
    </Dialog>
  );
};
