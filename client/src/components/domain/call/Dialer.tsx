import { useState } from "react";
import { Disc3, Phone, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useStartCall } from "@/hooks/useStartCall";
import { useDevices } from "@/stores/devices";
import { useAIAgents } from "@/stores/ai";

/** Reusable toggle switch for the dialer */
const InlineSwitch = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className={`switch-track relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent focus:outline-none focus:ring-2 focus:ring-primary ${
      checked ? "bg-amber-500" : "bg-muted"
    }`}
  >
    <span
      className={`switch-thumb pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow ${
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

  const micId = useDevices((s) => s.micId);
  const startCall = useStartCall(sid, micId);
  const activeConfig = useAIAgents((s) => s.activeSessionConfig);

  const submit = () => {
    if (!phone.trim() || startCall.isPending) return;

    if (callWithAI) {
      void startCall.mutateAsync({ phone: phone.trim(), record })
        .then((callId) => {
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
        })
        .catch(() => {});
    } else {
      startCall.mutate({ phone: phone.trim(), record }, { onSuccess: () => setPhone("") });
    }
  };

  return (
    <Card className="card-premium">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Phone className="h-4 w-4 text-primary" />
          Discador
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="+55 11 99999 9999"
            inputMode="tel"
            className="min-w-[200px] flex-1"
          />
          <Button
            type="button"
            variant={record ? "default" : "outline"}
            size="sm"
            onClick={() => setRecord((v) => !v)}
            aria-pressed={record}
            className="gap-1.5"
          >
            <Disc3 className="h-4 w-4" />
            Record
          </Button>
          <Button onClick={submit} disabled={startCall.isPending || !phone.trim()} className="gap-1.5">
            <Phone className="h-4 w-4" />
            {startCall.isPending ? "Calling…" : "Call"}
          </Button>
        </div>

        {/* AI Options */}
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500 fill-amber-500/20" />
              <Label className="text-sm font-medium cursor-pointer" htmlFor="callWithAI">
                Ligar usando a IA (Agente de Voz)
              </Label>
            </div>
            <InlineSwitch
              checked={callWithAI}
              onChange={(checked) => {
                setCallWithAI(checked);
                if (checked) {
                  setCustomGreeting(activeConfig?.firstUtterance || "");
                  setEnableGreeting(!!activeConfig?.firstUtterance);
                }
              }}
            />
          </div>

          {callWithAI && (
            <div className="space-y-3 pt-3 border-t border-amber-500/10 animate-fade-in">
              <div className="space-y-1.5">
                <Label htmlFor="customPrompt" className="text-xs">
                  Instrução Adicional para esta Chamada (Opcional)
                </Label>
                <Input
                  id="customPrompt"
                  placeholder="Ex: confirme a consulta da Luísa marcada para hoje às 15h"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  className="h-8 text-xs bg-background"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    id="enableGreeting"
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-gray-300 accent-amber-500"
                    checked={enableGreeting}
                    onChange={(e) => setEnableGreeting(e.target.checked)}
                  />
                  <Label htmlFor="enableGreeting" className="text-xs cursor-pointer">
                    Engajar com primeira fala ao conectar
                  </Label>
                </div>

                {enableGreeting && (
                  <Input
                    placeholder="Frase inicial que a IA falará..."
                    value={customGreeting}
                    onChange={(e) => setCustomGreeting(e.target.value)}
                    className="h-8 text-xs bg-background animate-fade-in-fast"
                  />
                )}
              </div>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Você pode fazer várias ligações ao mesmo tempo — disque outro número e uma nova chamada aparece abaixo.
        </p>
      </CardContent>
    </Card>
  );
};
