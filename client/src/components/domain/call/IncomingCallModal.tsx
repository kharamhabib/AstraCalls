import { useEffect, useState } from "react";
import { Phone, PhoneIncoming, PhoneOff, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCalls } from "@/stores/calls";
import { useDevices } from "@/stores/devices";
import { useAcceptCall } from "@/hooks/useAcceptCall";
import { useRejectCall } from "@/hooks/useRejectCall";
import { useContactInfo } from "@/hooks/useContactInfo";
import { getAIConfig } from "@/services/ai";
import { useAIAgents } from "@/stores/ai";
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
    setTimeout(scheduleCycle, 3000);
  };
  scheduleCycle();
  return {
    stop: () => {
      cancelled = true;
      void ctx.close().catch(() => {});
    },
  };
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export const IncomingCallModal = () => {
  const incoming = useCalls((s) => s.incoming);
  const micId = useDevices((s) => s.micId);
  const accept = useAcceptCall(micId);
  const reject = useRejectCall();
  const busy = accept.isPending || reject.isPending;

  const [aiConfig, setAiConfig] = useState<AIConfig | null>(null);
  const [, force] = useState(0);

  const { data: contact } = useContactInfo(incoming?.sessionId, incoming?.peer);

  useEffect(() => {
    if (!incoming) return;
    const ring = startRingLoop();
    return () => ring?.stop();
  }, [incoming]);

  useEffect(() => {
    if (!incoming) {
      setAiConfig(null);
      return;
    }
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
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
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/15 text-primary border-4 border-primary/10 shadow-md">
              {contact ? (
                <span className="text-2xl font-bold tracking-wider">{getInitials(contact.name)}</span>
              ) : (
                <PhoneIncoming className="h-10 w-10 animate-bounce" />
              )}
            </div>
          )}
          <div className="space-y-1">
            <DialogTitle className="text-xl font-bold text-foreground">Chamada Recebida</DialogTitle>
            <DialogDescription className="text-base font-semibold text-primary truncate max-w-[260px] mx-auto">
              {contact ? contact.name : incoming?.peer}
            </DialogDescription>
            {contact && contact.name !== incoming?.peer && (
              <p className="text-xs text-muted-foreground font-mono">{incoming?.peer.split("@")[0]}</p>
            )}
          </div>
        </DialogHeader>
        {showCountdown && remaining > 0 && (
          <div className="rounded-lg bg-amber-500/10 px-4 py-2 border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400 font-medium animate-pulse flex flex-col items-center gap-1 text-center">
            <span>A IA atenderá automaticamente em</span>
            <span className="font-bold text-lg tabular-nums">{remaining}s</span>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-3 w-full">
          {aiConfig && (
            <Button
              className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-bold py-5 flex items-center justify-center gap-2 shadow-md hover:scale-[1.02] transition-transform duration-200 rounded-xl"
              disabled={busy}
              onClick={handleAcceptWithAI}
            >
              <Sparkles className="h-4.5 w-4.5 fill-white/10 animate-pulse text-white" />
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
              aria-label="Reject"
            >
              <PhoneOff className="h-6 w-6" />
            </Button>
            <Button
              size="icon"
              className="h-14 w-14 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg hover:scale-105 transition-transform duration-200"
              disabled={busy}
              onClick={() => incoming && accept.mutate({ sid: incoming.sessionId, callId: incoming.callId })}
              aria-label="Accept"
            >
              <Phone className="h-6 w-6" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

