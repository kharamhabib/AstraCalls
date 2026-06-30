import { useState } from "react";
import { History, PhoneIncoming, PhoneOutgoing, Clock } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/shared/EmptyState";
import { useHistory } from "@/hooks/useHistory";

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
            Call history
          </SheetTitle>
        </SheetHeader>
        <Separator />
        <ScrollArea className="h-[calc(100vh-5.5rem)] px-4 py-4 custom-scrollbar">
          {rows.length === 0 ? (
            <EmptyState title="No past calls" description="Calls you make or receive will appear here." />
          ) : (
            <ul className="space-y-2 stagger-children">
              {rows.map((r) => {
                const isInbound = r.direction === "inbound";
                const DirIcon = isInbound ? PhoneIncoming : PhoneOutgoing;
                return (
                  <li key={r.callId} className="rounded-lg border p-3.5 card-premium">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                          isInbound ? "bg-blue-500/10 text-blue-500" : "bg-primary/10 text-primary"
                        }`}>
                          <DirIcon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-sm">{r.peer}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {new Date(r.startedAt).toLocaleString("pt-BR", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge variant={isInbound ? "secondary" : "muted"} className="text-[10px]">
                          {isInbound ? "Recebida" : "Efetuada"}
                        </Badge>
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDuration(r.startedAt, r.endedAt)}
                        </span>
                      </div>
                    </div>
                    {r.endReason && (
                      <p className="text-[10px] text-muted-foreground/70 mt-2 pl-10.5">
                        Motivo: {r.endReason}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};
