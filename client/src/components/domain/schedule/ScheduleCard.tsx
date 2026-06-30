import { PhoneCall, Trash2, Clock, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ScheduledCall } from "@/types/ai";

type ScheduleStatus = "pending" | "completed" | "cancelled";

function getStatus(s: ScheduledCall): ScheduleStatus {
  const isPast = new Date(s.time) <= new Date();
  if (s.active && !isPast) return "pending";
  if (!s.active && isPast) return "completed";
  return "cancelled";
}

const statusConfig: Record<ScheduleStatus, { label: string; variant: "secondary" | "success" | "destructive"; icon: typeof Clock }> = {
  pending: { label: "Pendente", variant: "secondary", icon: Clock },
  completed: { label: "Concluído", variant: "success", icon: CheckCircle2 },
  cancelled: { label: "Cancelado", variant: "destructive", icon: XCircle },
};

interface ScheduleCardProps {
  schedule: ScheduledCall;
  onDelete: (id: string) => void;
}

export const ScheduleCard = ({ schedule, onDelete }: ScheduleCardProps) => {
  const status = getStatus(schedule);
  const cfg = statusConfig[status];
  const StatusIcon = cfg.icon;

  return (
    <Card className="card-premium animate-fade-in">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <PhoneCall className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{schedule.phone}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(schedule.time).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge variant={cfg.variant} className="gap-1 text-[10px]">
              <StatusIcon className="h-3 w-3" />
              {cfg.label}
            </Badge>
            {status === "pending" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => onDelete(schedule.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Remover agendamento</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        {schedule.prompt && (
          <div className="mt-2.5 rounded-md bg-muted/40 p-2 text-xs text-muted-foreground border border-border/50">
            <span className="font-semibold text-foreground">Instruções/Roteiro:</span> {schedule.prompt}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export { getStatus };
export type { ScheduleStatus };
