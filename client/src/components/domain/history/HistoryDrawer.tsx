import { useState } from "react";
import { History, PhoneIncoming, PhoneOutgoing, Clock } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/shared/EmptyState";
import { useHistory } from "@/hooks/useHistory";
import { useContactInfo } from "@/hooks/useContactInfo";
import type { HistoryRow } from "@/types/history";

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

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  if (parts[0]) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return "?";
}

const HistoryItem = ({ sid, row }: { sid: string; row: HistoryRow }) => {
  const { data: contact } = useContactInfo(sid, row.phone);
  const isInbound = row.direction === "inbound";
  const DirIcon = isInbound ? PhoneIncoming : PhoneOutgoing;

  const formatPhoneNumber = (value: string) => {
    const cleaned = value.replace(/\D/g, "");
    if (cleaned.length === 0) return "";
    if (cleaned.length <= 2) return `+${cleaned}`;
    if (cleaned.length <= 4) return `+${cleaned.slice(0, 2)} (${cleaned.slice(2)}`;
    if (cleaned.length <= 8) return `+${cleaned.slice(0, 2)} (${cleaned.slice(2, 4)}) ${cleaned.slice(4)}`;
    if (cleaned.length <= 12) return `+${cleaned.slice(0, 2)} (${cleaned.slice(2, 4)}) ${cleaned.slice(4, 8)}-${cleaned.slice(8)}`;
    return `+${cleaned.slice(0, 2)} (${cleaned.slice(2, 4)}) ${cleaned.slice(4, 9)}-${cleaned.slice(9, 13)}`;
  };

  const displayName = row.name || contact?.name || formatPhoneNumber(row.phone);
  const hasContactName = (row.name || contact?.name) && (row.name || contact?.name) !== row.phone;
  const pictureUrl = contact?.pictureUrl;

  return (
    <li className="rounded-xl border border-primary/10 p-4 transition-all duration-300 hover:shadow-md card-premium space-y-3 animate-fade-in">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Avatar or Fallback */}
          {pictureUrl ? (
            <img
              src={pictureUrl}
              alt={displayName}
              className="h-10 w-10 shrink-0 rounded-full object-cover border border-primary/10 shadow-sm"
            />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground font-semibold text-xs border border-primary/5">
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
          <Badge variant={isInbound ? "secondary" : "default"} className={`text-[9px] px-1.5 h-4.5 font-semibold ${
            isInbound ? "" : "bg-primary hover:bg-primary/95 text-white"
          }`}>
            <span className="flex items-center gap-1">
              <DirIcon className="h-2.5 w-2.5" />
              {isInbound ? "Recebida" : "Efetuada"}
            </span>
          </Badge>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
            <Clock className="h-3 w-3 text-muted-foreground/80" />
            {formatDuration(row.startedAt, row.endedAt)}
          </span>
        </div>
      </div>

      {row.ticketOpened && (
        <div className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400 border border-amber-500/20 break-words leading-relaxed">
          <span className="font-bold flex items-center gap-1 mb-1 text-amber-700 dark:text-amber-300">
            ⚠️ Chamado Aberto
          </span>
          {row.ticketReason || "Sem motivo especificado pelo cliente."}
        </div>
      )}

      {row.summary && (
        <div className="rounded-lg bg-primary/5 p-3 text-xs text-muted-foreground border border-primary/10 break-words leading-relaxed">
          <span className="font-semibold text-primary block mb-1">Resumo do Atendimento:</span>
          {row.summary}
        </div>
      )}

      {row.endReason && (
        <div className="text-[10px] text-muted-foreground/60 pl-1 border-l-2 border-muted leading-tight">
          Causa de término: {row.endReason}
        </div>
      )}
    </li>
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
