import { useState, useRef, useEffect } from "react";
import { PhoneOff, Mic, MicOff, ChevronUp, ChevronDown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSessions } from "@/stores/sessions";
import { useCalls } from "@/stores/calls";
import { useAIAgents } from "@/stores/ai";
import { useContactInfo } from "@/hooks/useContactInfo";
import { formatPhoneNumber } from "@/utils/format";
import { endCall } from "@/services/calls";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const WebphoneDrawer = () => {
  const [expanded, setExpanded] = useState(false);
  const [muted, setMuted] = useState(false);
  const activeId = useSessions((s) => s.activeId);
  const calls = useCalls((s) => s.calls);

  const activeCall = calls.find((c) => c.sessionId === activeId && c.status !== "ended");
  const isAgentActive = activeCall ? useAIAgents.getState().activeAgentCalls.has(activeCall.callId) : false;
  const transcript = activeCall ? useAIAgents.getState().transcripts[activeCall.callId] || [] : [];
  const transcriptRef = useRef<HTMLDivElement>(null);

  const { data: contact } = useContactInfo(activeId, activeCall?.peer);
  const displayPhone = formatPhoneNumber(contact?.phone || activeCall?.peer);
  const displayName = contact?.name && contact.name !== contact.phone ? contact.name : displayPhone;

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  if (!activeCall) return null;

  const handleHangup = async () => {
    if (!activeId || !activeCall) return;
    try {
      await endCall(activeId, activeCall.callId);
      toast.info("Chamada encerrada.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-bounce-in">
      <div className="rounded-2xl border bg-card/95 p-3.5 shadow-2xl backdrop-blur-md min-w-[280px] max-w-sm space-y-3">
        {/* Header Widget */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-extrabold truncate max-w-[140px]" title={displayName}>
                {displayName}
              </p>
              <p className="text-[10px] text-muted-foreground font-medium">
                {isAgentActive ? "IA em Atendimento" : "Chamada Ativa"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setExpanded(!expanded)}
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>

            <Button
              variant="destructive"
              size="icon"
              onClick={handleHangup}
              className="h-8 w-8 rounded-xl shadow-xs"
              title="Desligar"
            >
              <PhoneOff className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Expanded Details & Transcript */}
        {expanded && (
          <div className="space-y-3 pt-2 border-t text-xs animate-fade-in">
            {transcript.length > 0 ? (
              <div ref={transcriptRef} className="rounded-xl border bg-muted/40 p-2.5 max-h-36 overflow-y-auto space-y-1.5 custom-scrollbar">
                {transcript.map((t, idx) => (
                  <div key={idx} className="flex items-start gap-1.5 text-[11px]">
                    <span className={cn("font-bold shrink-0", t.speaker === "ai" ? "text-primary" : "text-emerald-500")}>
                      {t.speaker === "ai" ? "IA:" : "Cliente:"}
                    </span>
                    <span className="text-muted-foreground">{t.text}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground italic text-center py-2">
                Aguardando transcrição em tempo real...
              </p>
            )}

            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMuted(!muted)}
                className="h-8 gap-1.5 rounded-lg text-xs"
              >
                {muted ? <MicOff className="h-3.5 w-3.5 text-amber-500" /> : <Mic className="h-3.5 w-3.5" />}
                <span>{muted ? "Desmutar" : "Mutar Mic"}</span>
              </Button>

              <span className="flex items-center gap-1 text-[10px] font-semibold text-primary">
                <Sparkles className="h-3 w-3" />
                <span>Gemini Live</span>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
