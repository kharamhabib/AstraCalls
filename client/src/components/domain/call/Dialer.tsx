import { useState } from "react";
import { Disc3, Phone, Sparkles, Calendar, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useStartCall } from "@/hooks/useStartCall";
import { useDevices } from "@/stores/devices";
import { useAIAgents } from "@/stores/ai";
import { setAIConfig } from "@/services/ai";
import { toast } from "sonner";

/** Reusable toggle switch for the dialer */
const InlineSwitch = ({ checked, onChange, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`switch-track relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent focus:outline-none focus:ring-2 focus:ring-primary transition-colors ${
      checked ? "bg-amber-500" : "bg-muted"
    } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
  >
    <span
      className={`switch-thumb pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
        checked ? "translate-x-5" : "translate-x-0"
      }`}
    />
  </button>
);

export const Dialer = ({ sid }: { sid: string }) => {
  const [phone, setPhone] = useState("");
  const [record, setRecord] = useState(false);

  // AI call options
  const [callWithAI, setCallWithAI] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [enableGreeting, setEnableGreeting] = useState(false);
  const [customGreeting, setCustomGreeting] = useState("");

  // Scheduling options
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduleTime, setScheduleTime] = useState("");
  const [busy, setBusy] = useState(false);

  const micId = useDevices((s) => s.micId);
  const startCall = useStartCall(sid, micId);
  const activeConfig = useAIAgents((s) => s.activeSessionConfig);
  const setActiveConfig = useAIAgents((s) => s.setActiveSessionConfig);

  const submit = async () => {
    const trimmedPhone = phone.trim();
    if (!trimmedPhone) return;

    // Remove non-numeric characters to sanitize
    const cleanPhone = trimmedPhone.replace(/\D/g, "");
    if (cleanPhone.length < 10) {
      toast.error("Por favor, insira um número válido com DDD (ex: 11999999999).");
      return;
    }

    if (isScheduled) {
      if (!scheduleTime) {
        toast.error("Selecione a data e hora para o agendamento.");
        return;
      }
      const dateObj = new Date(scheduleTime);
      if (dateObj <= new Date()) {
        toast.error("Escolha um horário no futuro.");
        return;
      }
      if (!activeConfig) {
        toast.error("Configurações de IA não disponíveis no momento.");
        return;
      }

      setBusy(true);
      try {
        let existingSchedules = [];
        try {
          existingSchedules = JSON.parse(activeConfig.scheduledCalls || "[]");
        } catch {
          existingSchedules = [];
        }

        const newCall = {
          id: Math.random().toString(36).substring(2, 11),
          phone: cleanPhone,
          time: dateObj.toISOString(),
          active: true,
          prompt: customPrompt.trim() || undefined,
        };

        const nextConfig = {
          ...activeConfig,
          scheduledCalls: JSON.stringify([...existingSchedules, newCall]),
        };

        await setAIConfig(sid, nextConfig);
        setActiveConfig(nextConfig);
        toast.success("Ligação agendada com sucesso!");

        // Reset fields
        setPhone("");
        setCustomPrompt("");
        setIsScheduled(false);
        setScheduleTime("");
      } catch (err) {
        console.error("Erro ao agendar chamada:", err);
        toast.error(`Falha ao agendar: ${(err as Error).message}`);
      } finally {
        setBusy(false);
      }
    } else {
      // Direct call (now or using AI now)
      setBusy(true);
      if (callWithAI) {
        startCall.mutate({
          phone: cleanPhone,
          record,
          ai: true,
          prompt: customPrompt.trim() || undefined,
          greeting: enableGreeting ? (customGreeting.trim() || undefined) : undefined
        }, {
          onSuccess: (callId) => {
            useAIAgents.getState().addScheduledInProgress(callId);

            if (customPrompt.trim() !== "") {
              useAIAgents.getState().setCustomPrompt(callId, customPrompt.trim());
            }
            if (enableGreeting && customGreeting.trim() !== "") {
              useAIAgents.getState().setCustomGreeting(callId, customGreeting.trim());
            } else {
              useAIAgents.getState().setCustomGreeting(callId, "");
            }

            setPhone("");
            setCustomPrompt("");
            setBusy(false);
          },
          onError: () => {
            setBusy(false);
          }
        });
      } else {
        startCall.mutate({ phone: cleanPhone, record }, {
          onSuccess: () => {
            setPhone("");
            setBusy(false);
          },
          onError: () => {
            setBusy(false);
          }
        });
      }
    }
  };

  const formatPhoneNumber = (value: string) => {
    // Basic phone formatting (e.g. +55 11 99999-9999)
    const cleaned = value.replace(/\D/g, "");
    if (cleaned.length === 0) return "";
    if (cleaned.length <= 2) return `+${cleaned}`;
    if (cleaned.length <= 4) return `+${cleaned.slice(0, 2)} (${cleaned.slice(2)}`;
    if (cleaned.length <= 8) return `+${cleaned.slice(0, 2)} (${cleaned.slice(2, 4)}) ${cleaned.slice(4)}`;
    if (cleaned.length <= 12) return `+${cleaned.slice(0, 2)} (${cleaned.slice(2, 4)}) ${cleaned.slice(4, 8)}-${cleaned.slice(8)}`;
    return `+${cleaned.slice(0, 2)} (${cleaned.slice(2, 4)}) ${cleaned.slice(4, 9)}-${cleaned.slice(9, 13)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value;
    // Format if it starts with digit or "+", otherwise keep raw
    if (/^\+?\d*$/.test(rawVal.replace(/[\s()\-]/g, ""))) {
      setPhone(formatPhoneNumber(rawVal));
    } else {
      setPhone(rawVal);
    }
  };

  return (
    <Card className="card-premium transition-all duration-300 hover:shadow-md border border-primary/10">
      <CardHeader className="pb-3 border-b border-primary/5">
        <CardTitle className="flex items-center gap-2 text-base font-bold text-foreground">
          <Phone className="h-4 w-4 text-primary" />
          Discador Inteligente
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {/* Phone input and basic controls */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Input
              value={phone}
              onChange={handlePhoneChange}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="+55 11 99999-9999"
              inputMode="tel"
              className="pr-10 h-10 text-sm bg-background border-primary/20 focus-visible:ring-primary/30"
              disabled={busy || startCall.isPending}
            />
            {phone && (
              <button
                type="button"
                onClick={() => setPhone("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
              >
                Limpar
              </button>
            )}
          </div>
          
          <div className="flex gap-2">
            <Button
              type="button"
              variant={record ? "default" : "outline"}
              size="sm"
              onClick={() => setRecord((v) => !v)}
              aria-pressed={record}
              className={`gap-1.5 h-10 border-primary/20 text-xs ${
                record ? "bg-red-500 hover:bg-red-600 text-white border-red-500" : ""
              }`}
              disabled={busy || startCall.isPending}
            >
              <Disc3 className={`h-4 w-4 ${record ? "animate-pulse" : ""}`} />
              Gravar
            </Button>
            
            <Button 
              onClick={submit} 
              disabled={busy || startCall.isPending || !phone.trim()} 
              className={`gap-1.5 h-10 text-xs px-4 font-semibold ${
                isScheduled 
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white" 
                  : "bg-primary hover:bg-primary/90 text-primary-foreground"
              }`}
            >
              {isScheduled ? (
                <>
                  <Calendar className="h-4 w-4" />
                  {busy ? "Agendando..." : "Agendar"}
                </>
              ) : (
                <>
                  <Phone className="h-4 w-4" />
                  {startCall.isPending || busy ? "Ligando..." : "Ligar"}
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Option panels: AI Call and Schedule Call */}
        <div className="rounded-lg border border-primary/10 bg-muted/20 p-3.5 space-y-3">
          
          {/* Row 1: Call using AI Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className={`h-4 w-4 ${callWithAI ? "text-amber-500 fill-amber-500/20" : "text-muted-foreground"}`} />
              <div className="space-y-0.5">
                <Label className="text-sm font-semibold cursor-pointer text-foreground" htmlFor="callWithAI">
                  Ligar usando a IA (Agente de Voz)
                </Label>
                <p className="text-[10px] text-muted-foreground">O agente inteligente responderá na ligação automaticamente</p>
              </div>
            </div>
            <InlineSwitch
              checked={callWithAI}
              disabled={isScheduled || busy || startCall.isPending} // Enforced if scheduled
              onChange={(checked) => {
                setCallWithAI(checked);
                if (checked) {
                  setCustomGreeting(activeConfig?.firstUtterance || "");
                  setEnableGreeting(!!activeConfig?.firstUtterance);
                }
              }}
            />
          </div>

          {/* Row 2: Schedule Call Toggle */}
          <div className="border-t border-primary/5 pt-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className={`h-4 w-4 ${isScheduled ? "text-emerald-500" : "text-muted-foreground"}`} />
              <div className="space-y-0.5">
                <Label className="text-sm font-semibold cursor-pointer text-foreground" htmlFor="isScheduled">
                  Agendar Ligação para depois
                </Label>
                <p className="text-[10px] text-muted-foreground">Programe o disparo e a IA ligará no horário definido</p>
              </div>
            </div>
            <InlineSwitch
              checked={isScheduled}
              disabled={busy || startCall.isPending}
              onChange={(checked) => {
                setIsScheduled(checked);
                if (checked) {
                  setCallWithAI(true); // Enforce AI when scheduling
                  setCustomGreeting(activeConfig?.firstUtterance || "");
                  setEnableGreeting(!!activeConfig?.firstUtterance);
                }
              }}
            />
          </div>

          {/* Conditional Input: Schedule DateTime Picker */}
          {isScheduled && (
            <div className="space-y-1.5 pt-3 border-t border-primary/5 animate-fade-in">
              <Label htmlFor="scheduleTime" className="text-xs font-semibold text-foreground flex items-center gap-1">
                <Clock className="h-3 w-3 text-emerald-500" />
                Data e Hora do Disparo
              </Label>
              <Input
                id="scheduleTime"
                type="datetime-local"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                className="h-9 text-xs bg-background border-emerald-500/30 focus-visible:ring-emerald-500/20"
                disabled={busy || startCall.isPending}
              />
            </div>
          )}

          {/* Conditional Inputs: AI Prompt and Greeting (Available for AI calls or scheduled calls) */}
          {callWithAI && (
            <div className="space-y-3 pt-3 border-t border-primary/5 animate-fade-in">
              <div className="space-y-1.5">
                <Label htmlFor="customPrompt" className="text-xs font-semibold">
                  Instrução Adicional para esta Chamada (Opcional)
                </Label>
                <Input
                  id="customPrompt"
                  placeholder="Ex: confirme a consulta da Luísa marcada para hoje às 15h"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  className="h-9 text-xs bg-background border-primary/20"
                  disabled={busy || startCall.isPending}
                />
              </div>

              {!isScheduled && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      id="enableGreeting"
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-gray-300 accent-amber-500 cursor-pointer"
                      checked={enableGreeting}
                      onChange={(e) => setEnableGreeting(e.target.checked)}
                      disabled={busy || startCall.isPending}
                    />
                    <Label htmlFor="enableGreeting" className="text-xs font-medium cursor-pointer text-muted-foreground">
                      Engajar com primeira fala ao conectar
                    </Label>
                  </div>

                  {enableGreeting && (
                    <Input
                      placeholder="Frase inicial que a IA falará..."
                      value={customGreeting}
                      onChange={(e) => setCustomGreeting(e.target.value)}
                      className="h-9 text-xs bg-background border-primary/20 animate-fade-in-fast"
                      disabled={busy || startCall.isPending}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
          Você pode fazer várias ligações ao mesmo tempo — disque outro número e uma nova chamada aparece abaixo.
        </p>
      </CardContent>
    </Card>
  );
};

