import { useEffect } from "react";
import { Phone, PhoneIncoming, PhoneOff } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCalls } from "@/stores/calls";
import { useDevices } from "@/stores/devices";
import { useAcceptCall } from "@/hooks/useAcceptCall";
import { useRejectCall } from "@/hooks/useRejectCall";
import { useContactInfo } from "@/hooks/useContactInfo";

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

  const { data: contact } = useContactInfo(incoming?.sessionId, incoming?.peer);

  useEffect(() => {
    if (!incoming) return;
    const ring = startRingLoop();
    return () => ring?.stop();
  }, [incoming]);

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
        <div className="mt-4 flex items-center justify-center gap-8">
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
      </DialogContent>
    </Dialog>
  );
};

