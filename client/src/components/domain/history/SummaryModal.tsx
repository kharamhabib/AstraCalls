import { useState } from "react";
import { FileText, Sparkles, Copy, Check, PhoneIncoming, PhoneOutgoing, Clock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { HistoryRow } from "@/types/history";
import { formatPhoneNumber, formatDuration } from "@/utils/format";

interface SummaryModalProps {
  row: HistoryRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayName: string;
}

export const SummaryModal = ({ row, open, onOpenChange, displayName }: SummaryModalProps) => {
  const [copied, setCopied] = useState(false);

  const isInbound = row.direction === "inbound";
  const DirIcon = isInbound ? PhoneIncoming : PhoneOutgoing;

  const handleCopy = () => {
    if (!row.summary) return;
    navigator.clipboard.writeText(row.summary);
    setCopied(true);
    toast.success("Resumo copiado para a área de transferência!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl rounded-2xl p-6 gap-4 shadow-2xl border bg-card text-card-foreground animate-scale-in">
        {/* Modal Header */}
        <DialogHeader className="space-y-3 pb-3 border-b">
          <div className="flex items-start justify-between gap-3 pr-6">
            <div className="space-y-1 min-w-0">
              <DialogTitle className="text-lg font-extrabold flex items-center gap-2 text-foreground">
                <Sparkles className="h-5 w-5 text-primary shrink-0" />
                <span className="truncate">Resumo: {displayName}</span>
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

            {row.summary && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                className="h-7 text-xs gap-1.5 rounded-lg hover:bg-primary/10"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? "Copiado!" : "Copiar Resumo"}</span>
              </Button>
            )}
          </div>
        </DialogHeader>

        {/* Modal Body: Call Summary Content */}
        <div className="overflow-y-auto max-h-[50vh] p-1">
          {row.summary ? (
            <div className="rounded-xl bg-primary/5 p-4.5 text-xs text-foreground/90 border border-primary/10 whitespace-pre-wrap break-words leading-relaxed font-normal shadow-xs">
              {row.summary}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground space-y-2 text-center">
              <FileText className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-xs font-semibold">Nenhum resumo disponível para esta ligação.</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
