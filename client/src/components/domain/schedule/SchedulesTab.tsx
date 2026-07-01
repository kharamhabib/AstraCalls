import { useEffect, useState } from "react";
import { Calendar, Plus, Clock, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import { ScheduleCard, getStatus, type ScheduleStatus } from "./ScheduleCard";
import { getAIConfig, setAIConfig } from "@/services/ai";
import type { AIConfig, ScheduledCall } from "@/types/ai";

const columns: { id: ScheduleStatus; label: string; icon: typeof Clock }[] = [
  { id: "pending", label: "Pendente", icon: Clock },
  { id: "completed", label: "Concluído", icon: CheckCircle2 },
  { id: "cancelled", label: "Cancelado", icon: XCircle },
];

export const SchedulesTab = ({ sid }: { sid: string }) => {
  const [schedules, setSchedules] = useState<ScheduledCall[]>([]);  const [config, setConfig] = useState<AIConfig | null>(null);
  const [newPhone, setNewPhone] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBusy(true);
    getAIConfig(sid)
      .then((r) => {
        if (r.aiConfig) {
          setConfig(r.aiConfig);
          try {
            setSchedules(JSON.parse(r.aiConfig.scheduledCalls || "[]"));
          } catch {
            setSchedules([]);
          }
        }
      })
      .catch(() => toast.error("Falha ao carregar agendamentos"))
      .finally(() => setBusy(false));
  }, [sid]);

  const persistSchedules = async (next: ScheduledCall[]) => {
    if (!config) return;
    const nextConfig = { ...config, scheduledCalls: JSON.stringify(next) };
    try {
      await setAIConfig(sid, nextConfig);
      setConfig(nextConfig);
      setSchedules(next);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleAdd = () => {
    if (!newPhone.trim() || !newTime) {
      toast.error("Preencha o telefone e a hora do agendamento");
      return;
    }
    const cleanPhone = newPhone.replace(/\D/g, "");
    if (cleanPhone.length < 10) {
      toast.error("Telefone inválido");
      return;
    }
    const scheduledDate = new Date(newTime);
    if (scheduledDate <= new Date()) {
      toast.error("Escolha um horário no futuro");
      return;
    }

    const newCall: ScheduledCall = {
      id: Math.random().toString(36).substring(2, 11),
      phone: cleanPhone,
      time: scheduledDate.toISOString(),
      active: true,
      prompt: newPrompt.trim() || undefined
    };

    void persistSchedules([...schedules, newCall]);
    setNewPhone("");
    setNewTime("");
    setNewPrompt("");
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    const target = schedules.find((s) => s.id === id);
    if (target && getStatus(target) === "pending") {
      // Cancel it (move to Cancelado)
      const next = schedules.map((s) => (s.id === id ? { ...s, active: false } : s));
      void persistSchedules(next);
      toast.success("Agendamento cancelado");
    } else {
      // Delete it completely
      void persistSchedules(schedules.filter((s) => s.id !== id));
      toast.success("Histórico excluído");
    }
  };

  const grouped = columns.map((col) => {
    const items = schedules.filter((s) => getStatus(s) === col.id);
    // Sort items by time
    if (col.id === "pending") {
      // Soonest first
      items.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    } else {
      // Latest first
      items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    }
    return {
      ...col,
      items,
    };
  });

  if (!config && !busy) {
    return (
      <div className="animate-fade-in">
        <EmptyState
          icon={<Calendar className="h-6 w-6" />}
          title="IA não configurada"
          description="Configure a integração de IA nas Configurações para poder agendar ligações."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Ligações Agendadas</h2>
          <p className="text-sm text-muted-foreground">
            Gerencie as ligações automáticas programadas pela IA.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setShowForm((v) => !v)}
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Novo Agendamento</span>
        </Button>
      </div>

      {/* New schedule form */}
      {showForm && (
        <Card className="card-premium animate-slide-up border-primary/20">
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-primary" />
              Programar Ligação Ativa
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">WhatsApp (Telefone)</Label>
                <Input
                  type="text"
                  placeholder="Ex: 5511999999999"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Data e Hora de Disparo</Label>
                <Input
                  type="datetime-local"
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                />
              </div>
            </div>
            
            <div className="space-y-1.5">
              <Label className="text-xs">Motivo / Roteiro / Prompt complementar (Opcional)</Label>
              <textarea
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
                placeholder="Ex: Confirme nossa reunião às 10 da manhã. Pergunte se o endereço da reunião é no escritório principal."
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
              <Button size="sm" onClick={handleAdd} className="gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                Agendar Ligação
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Kanban columns */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {grouped.map((col) => {
          const ColIcon = col.icon;
          return (
            <div key={col.id} className="space-y-2.5">
              <div className="flex items-center gap-2 px-1">
                <ColIcon className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {col.label}
                </h3>
                <span className="text-xs text-muted-foreground/60">({col.items.length})</span>
              </div>
              <div className="space-y-2 min-h-[100px] rounded-lg border border-dashed p-2 bg-muted/20">
                {col.items.length === 0 ? (
                  <p className="text-xs text-center text-muted-foreground py-8">
                    Nenhum agendamento
                  </p>
                ) : (
                  col.items.map((s) => (
                    <ScheduleCard key={s.id} sid={sid} schedule={s} onDelete={handleDelete} />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
