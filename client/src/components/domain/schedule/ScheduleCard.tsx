import { Trash2, Clock, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useContactInfo } from "@/hooks/useContactInfo";
import type { ScheduledCall } from "@/types/ai";

type ScheduleStatus = "pending" | "completed" | "cancelled";

function getStatus(s: ScheduledCall): ScheduleStatus {
  if (s.active) return "pending";
  const isPast = new Date(s.time) <= new Date();
  if (isPast) return "completed";
  return "cancelled";
}

const statusConfig: Record<ScheduleStatus, { label: string; variant: "secondary" | "success" | "destructive"; icon: typeof Clock }> = {
  pending: { label: "Pendente", variant: "secondary", icon: Clock },
  completed: { label: "Concluído", variant: "success", icon: CheckCircle2 },
  cancelled: { label: "Cancelado", variant: "destructive", icon: XCircle },
};

function getInitials(name: string): string {
  const parts = name.split(" ");
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

interface ScheduleCardProps {
  sid: string;
  schedule: ScheduledCall;
  onDelete: (id: string) => void;
}

export const ScheduleCard = ({ sid, schedule, onDelete }: ScheduleCardProps) => {
  const { data: contact } = useContactInfo(sid, schedule.phone);
  const status = getStatus(schedule);
  const cfg = statusConfig[status];
  const StatusIcon = cfg.icon;

  const formatPhoneNumber = (value: string) => {
    const cleaned = value.replace(/\D/g, "");
    if (cleaned.length === 0) return "";
    if (cleaned.length <= 2) return `+${cleaned}`;
    if (cleaned.length <= 4) return `+${cleaned.slice(0, 2)} (${cleaned.slice(2)}`;
    if (cleaned.length <= 8) return `+${cleaned.slice(0, 2)} (${cleaned.slice(2, 4)}) ${cleaned.slice(4)}`;
    if (cleaned.length <= 12) return `+${cleaned.slice(0, 2)} (${cleaned.slice(2, 4)}) ${cleaned.slice(4, 8)}-${cleaned.slice(8)}`;
    return `+${cleaned.slice(0, 2)} (${cleaned.slice(2, 4)}) ${cleaned.slice(4, 9)}-${cleaned.slice(9, 13)}`;
  };

  const displayName = contact ? contact.name : formatPhoneNumber(schedule.phone);
  const hasContactName = contact && contact.name !== schedule.phone;

  return (
    <Card className="card-premium transition-all duration-300 hover:shadow-md border border-primary/10">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Avatar or Fallback */}
            {contact?.pictureUrl ? (
              <img
                src={contact.pictureUrl}
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
                  {formatPhoneNumber(schedule.phone)}
                </p>
              )}
              <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3 text-primary/70 shrink-0" />
                <span>
                  {new Date(schedule.time).toLocaleString("pt-BR", {
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

          <div className="flex items-center gap-1 shrink-0">
            <Badge variant={cfg.variant} className="gap-1 text-[9px] px-1.5 h-5 font-semibold">
              <StatusIcon className="h-2.5 w-2.5" />
              {cfg.label}
            </Badge>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => onDelete(schedule.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {status === "pending" ? "Cancelar agendamento" : "Excluir histórico"}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {schedule.prompt && (
          <div className="rounded-md bg-muted/40 p-2.5 text-xs text-muted-foreground border border-border/50 break-words leading-normal">
            <span className="font-semibold text-foreground">Instruções/Roteiro:</span> {schedule.prompt}
          </div>
        )}

        {schedule.summary && (
          <div className="rounded-md bg-primary/5 p-2.5 text-xs text-muted-foreground border border-primary/10 break-words leading-normal mt-2">
            <span className="font-semibold text-primary">Resumo do Atendimento:</span> {schedule.summary}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export { getStatus };
export type { ScheduleStatus };
