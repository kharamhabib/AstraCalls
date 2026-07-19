import { useEffect, useState } from "react";
import { Phone, PhoneIncoming, PhoneOff, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCalls } from "@/stores/calls";
import { useDevices } from "@/stores/devices";
import { useAcceptCall } from "@/hooks/useAcceptCall";
import { useRejectCall } from "@/hooks/useRejectCall";
import { useContactInfo } from "@/hooks/useContactInfo";
import { formatPhoneNumber, getInitials } from "@/utils/format";
import { getAIConfig } from "@/services/ai";
import { useAIAgents } from "@/stores/ai";
import { useNow } from "@/lib/use-now";
import type { AIConfig } from "@/types/ai";

type RingHandle = { stop: () => void };

const startRingLoop = (): RingHandle | null => {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  let ctx: AudioContext;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const playToneAt = (when: number, durationSec: number, freq: number, gainVal = 0.18) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = ctx.currentTime + when;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(gainVal, t + 0.02);
    gain.gain.linearRampToValueAtTime(gainVal, t + durationSec - 0.02);
    gain.gain.linearRampToValueAtTime(0, t + durationSec);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + durationSec + 0.05);
  };
  const scheduleCycle = () => {
    if (cancelled) return;
    playToneAt(0, 1.0, 440);
    playToneAt(0, 1.0, 480);
    timer = setTimeout(scheduleCycle, 3000);
  };
  scheduleCycle();
  return {
    stop: () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      void ctx.close().catch(() => {});
    },
  };
};

export const IncomingCallModal = () => {
  const incoming = useCalls((s) => s.incoming);
  const micId = useDevices((s) => s.micId);
  const accept = useAcceptCall(micId);
  const reject = useRejectCall();
  const busy = accept.isPending || reject.isPending;

  const [aiConfig, setAiConfig] = useState<AIConfig | null>(null);
  useNow(); // relógio compartilhado para o countdown do auto-atendimento

  const { data: contact } = useContactInfo(incoming?.sessionId, incoming?.peer);

  useEffect(() => {
    if (!incoming) return;
    const ring = startRingLoop();
    return () => ring?.stop();
  }, [incoming]);

  useEffect(() => {
    if (!incoming) {
      setAiConfig(null);
    }
  }, [incoming]);

  useEffect(() => {
    if (!incoming) return;
    getAIConfig(incoming.sessionId)
      .then((r) => {
        if (r.enabled && r.aiConfig) {
          setAiConfig(r.aiConfig);
        }
      })
      .catch(() => {});
  }, [incoming]);

  const handleAcceptWithAI = () => {
    if (!incoming) return;
    if (aiConfig && !aiConfig.serverSideAI) {
      useAIAgents.getState().addScheduledInProgress(incoming.callId);
    }
    accept.mutate({ sid: incoming.sessionId, callId: incoming.callId, ai: true });
  };

  const showCountdown =
    !!incoming &&
    !!aiConfig?.autoAnswer &&
    (aiConfig.autoAnswerDelay ?? 0) > 0;

  const remaining = showCountdown
    ? Math.max(0, Math.ceil((incoming!.offeredAt + aiConfig!.autoAnswerDelay * 1000 - Date.now()) / 1000))
    : 0;

  return (
    <Dialog open={!!incoming}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="sm:max-w-sm card-premium"
      >
        <DialogHeader className="items-center text-center space-y-3">
          {contact?.pictureUrl ? (
            <img
              src={contact.pictureUrl}
              alt={contact.name}
              className="h-20 w-20 rounded-full object-cover border-4 border-primary/20 shadow-lg animate-pulse-glow"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/15 text-primary border-4 border-primary/10 shadow-md animate-radar-ripple">
              {contact ? (
                <span className="text-2xl font-bold tracking-wider">{getInitials(contact.name)}</span>
              ) : (
                <PhoneIncoming className="h-10 w-10" />
              )}
            </div>
          )}
          <div className="space-y-1">
            <DialogTitle className="text-xl font-bold text-foreground">Chamada Recebida</DialogTitle>
            <DialogDescription className="text-base font-semibold text-primary truncate max-w-[260px] mx-auto">
              {contact?.name && contact.name !== contact.phone ? contact.name : formatPhoneNumber(contact?.phone || incoming?.peer)}
            </DialogDescription>
            {contact?.name && contact.name !== contact.phone && (
              <p className="text-xs text-muted-foreground font-mono">{formatPhoneNumber(contact?.phone || incoming?.peer)}</p>
            )}
          </div>
        </DialogHeader>
        {showCountdown && remaining > 0 && (
          <div className="rounded-lg bg-warning/10 px-4 py-2 border border-warning/20 text-xs text-warning-text font-medium animate-pulse flex flex-col items-center gap-1 text-center">
            <span>A IA atenderá automaticamente em</span>
            <span className="font-bold text-lg tabular-nums">{remaining}s</span>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-3 w-full">
          {aiConfig && (
            <Button
              className="w-full bg-warning hover:bg-warning/90 text-warning-foreground font-bold py-5 flex items-center justify-center gap-2 shadow-md hover:scale-[1.02] transition-transform duration-200 rounded-xl"
              disabled={busy}
              onClick={handleAcceptWithAI}
            >
              <Sparkles className="h-4.5 w-4.5 animate-pulse text-warning-foreground" />
              Atender com IA
            </Button>
          )}

          <div className="flex items-center justify-center gap-8 mt-1">
            <Button
              variant="destructive"
              size="icon"
              className="h-14 w-14 rounded-full shadow-lg hover:scale-105 transition-transform duration-200"
              disabled={busy}
              onClick={() => incoming && reject.mutate({ sid: incoming.sessionId, callId: incoming.callId })}
              aria-label="Recusar chamada"
            >
              <PhoneOff className="h-6 w-6" />
            </Button>
            <Button
              size="icon"
              className="h-14 w-14 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg hover:scale-105 transition-transform duration-200"
              disabled={busy}
              onClick={() => incoming && accept.mutate({ sid: incoming.sessionId, callId: incoming.callId })}
              aria-label="Atender chamada"
            >
              <Phone className="h-6 w-6" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

