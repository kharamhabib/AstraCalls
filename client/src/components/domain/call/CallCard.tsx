import { useEffect, useRef, useState } from "react";
import { PhoneOff, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { attachMeter } from "@/lib/audio-meter";
import { useNow } from "@/lib/use-now";
import { useCalls } from "@/stores/calls";
import { useDevices } from "@/stores/devices";
import { useEndCall } from "@/hooks/useEndCall";
import { formatCallDuration } from "@/utils/format";
import type { CallStatus, CallSummary } from "@/types/call";
import { useAIAgents, type TranscriptLine } from "@/stores/ai";
import { getAIConfig } from "@/services/ai";
import type { AIConfig } from "@/types/ai";
import { toast } from "sonner";
import { useContactInfo } from "@/hooks/useContactInfo";
import { cn } from "@/lib/utils";

const statusVariant: Record<CallStatus, "success" | "secondary" | "muted"> = {
  connected: "success",
  ringing: "secondary",
  starting: "secondary",
  ended: "muted",
};

const Meter = ({ label, db }: { label: string; db: number }) => {
  const pct = Math.max(0, Math.min(100, Math.round(((db + 60) / 60) * 100)));
  return (
    <div className="space-y-1">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <div 
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary transition-all duration-100"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

const EMPTY_TRANSCRIPT: TranscriptLine[] = [];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export const CallCard = ({ call }: { call: CallSummary }) => {
  const conn = useCalls((s) => s.ownConnections.get(call.callId));
  const outDeviceId = useDevices((s) => s.outId);
  const endCall = useEndCall();
  useNow(); // relógio compartilhado: re-render 1x/s para cronômetro/countdown
  const [micDb, setMicDb] = useState(-60);
  const [peerDb, setPeerDb] = useState(-60);
  const audioRef = useRef<HTMLAudioElement>(null);

  // AI voice states
  const [aiConfig, setAiConfig] = useState<AIConfig | null>(null);
  const [busyAI, setBusyAI] = useState(false);
  const isAIActive = useAIAgents((s) => s.activeAgentCalls.has(call.callId));
  const transcripts = useAIAgents((s) => s.transcripts[call.callId] || EMPTY_TRANSCRIPT);

  const { data: contact } = useContactInfo(call.sessionId, call.peer);

  useEffect(() => {
    getAIConfig(call.sessionId)
      .then((r) => {
        if (r.enabled && r.aiConfig) {
          setAiConfig(r.aiConfig);
        }
      })
      .catch(() => {});
  }, [call.sessionId]);

  useEffect(() => {
    if (!conn) return;
    const offMic = attachMeter(conn.micStream, setMicDb);
    let offPeer: (() => void) | null = null;
    const wait = setInterval(() => {
      if (conn.remoteStream && audioRef.current) {
        audioRef.current.srcObject = conn.remoteStream;
        audioRef.current.play().catch(() => {});
        offPeer = attachMeter(conn.remoteStream, setPeerDb);
        clearInterval(wait);
      }
    }, 200);
    return () => {
      offMic();
      offPeer?.();
      clearInterval(wait);
    };
  }, [conn]);

  useEffect(() => {
    const el = audioRef.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!el || !outDeviceId || typeof el.setSinkId !== "function") return;
    el.setSinkId(outDeviceId).catch(() => {});
  }, [outDeviceId, conn]);

  const toggleAI = async () => {
    if (!conn || !aiConfig) return;
    setBusyAI(true);
    try {
      if (isAIActive) {
        const agent = useAIAgents.getState().activeAgents.get(call.callId);
        if (agent) {
          await agent.detach();
        }
        useAIAgents.getState().setAgentInstance(call.callId, null);
        toast.info("IA de voz desconectada. Controle do microfone restaurado.");
      } else {
        const { GeminiLiveAgent } = await import("@/lib/gemini-live");
        const remoteStream = conn.remoteStream;
        if (!remoteStream) {
          toast.error("Aguardando conexão de áudio do cliente...");
          return;
        }
        const agent = new GeminiLiveAgent(
          call.callId,
          conn.pc,
          conn.micStream,
          remoteStream,
          aiConfig
        );
        useAIAgents.getState().setAgentInstance(call.callId, agent);
        await agent.start();
        toast.success("IA de voz conectada a esta chamada!");
      }
    } catch (e) {
      toast.error(`Falha ao alternar IA: ${(e as Error).message}`);
      const agent = useAIAgents.getState().activeAgents.get(call.callId);
      if (agent) {
        await agent.detach().catch(() => {});
      }
      useAIAgents.getState().setAgentInstance(call.callId, null);
    } finally {
      setBusyAI(false);
    }
  };

  return (
    <Card className="card-premium">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {contact?.pictureUrl ? (
              <img
                src={contact.pictureUrl}
                alt={contact.name}
                className="h-11 w-11 rounded-full object-cover border border-primary/10 shadow-sm"
              />
            ) : (
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground font-semibold text-sm border border-primary/5">
                {contact ? getInitials(contact.name) : "?"}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate font-bold text-sm text-foreground">
                {contact ? contact.name : call.peer}
              </p>
              {contact && contact.name !== call.peer && (
                <p className="text-[10px] text-muted-foreground font-mono truncate max-w-[150px]">
                  {call.peer.split("@")[0]}
                </p>
              )}
              <Badge variant={statusVariant[call.status]} className="mt-1 h-4 text-[9px] px-1.5 font-medium">
                {formatCallDuration(call.startedAt, call.status)}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {conn && aiConfig && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={isAIActive ? "default" : "outline"}
                    size="icon"
                    disabled={busyAI}
                    onClick={toggleAI}
                    className={
                      isAIActive
                        ? "bg-warning hover:bg-warning/90 text-warning-foreground animate-pulse-glow"
                        : ""
                    }
                    aria-label={isAIActive ? "Desativar IA" : "Ativar IA"}
                  >
                    <Sparkles className={`h-4 w-4 ${isAIActive ? "fill-warning-foreground/20 text-warning-foreground" : "text-warning-text"}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{isAIActive ? "Desativar IA" : "Ativar IA"}</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() => {
                    console.log("[CallCard] Clicou para encerrar chamada:", { sid: call.sessionId, callId: call.callId });
                    endCall.mutate({ sid: call.sessionId, callId: call.callId });
                  }}
                  aria-label="Encerrar chamada"
                >
                  <PhoneOff className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Encerrar chamada</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {call.status === "ringing" &&
          call.direction === "inbound" &&
          aiConfig?.autoAnswer &&
          (aiConfig.autoAnswerDelay ?? 0) > 0 && (
            (() => {
              const remaining = Math.max(0, Math.ceil((call.startedAt + aiConfig.autoAnswerDelay * 1000 - Date.now()) / 1000));
              if (remaining <= 0) return null;
              return (
                <div className="rounded-md bg-warning/10 px-3 py-1.5 border border-warning/20 text-xs text-warning-text font-medium animate-pulse flex items-center justify-between">
                  <span>A IA atenderá automaticamente em:</span>
                  <span className="font-bold text-sm tabular-nums">{remaining}s</span>
                </div>
              );
            })()
          )}

        <div className="space-y-2">
          <Meter label="Mic" db={micDb} />
          <Meter label="Peer" db={peerDb} />
        </div>

        {/* Real-time transcription */}
        {transcripts.length > 0 && (
          <div className="border-t pt-4 space-y-3 max-h-48 overflow-y-auto bg-muted/10 p-3 rounded-xl border border-primary/5 custom-scrollbar animate-fade-in">
            <p className="font-semibold text-xs text-muted-foreground mb-2 flex items-center gap-1.5 px-1">
              <Sparkles className="h-3.5 w-3.5 text-primary fill-primary/10" />
              <span>Conversa em tempo real</span>
            </p>
            <div className="space-y-3">
              {transcripts.map((line, idx) => (
                <div 
                  key={idx} 
                  className={cn(
                    "flex flex-col gap-1 w-full animate-fade-in-fast",
                    line.speaker === "ai" ? "items-end" : "items-start"
                  )}
                >
                  <span className="text-[9px] font-semibold text-muted-foreground/80 tracking-wider uppercase px-1.5">
                    {line.speaker === "ai" ? "IA" : "Cliente"}
                  </span>
                  <div 
                    className={cn(
                      "rounded-2xl px-3 py-2 text-xs shadow-sm max-w-[85%] leading-relaxed border break-words",
                      line.speaker === "ai"
                        ? "bg-primary/10 text-emerald-900 dark:text-emerald-100 border-primary/20 rounded-tr-none"
                        : "bg-card text-foreground border-border/80 rounded-tl-none"
                    )}
                  >
                    {line.text}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <audio ref={audioRef} autoPlay muted={!!(aiConfig?.silenceOperator && isAIActive)} />
      </CardContent>
    </Card>
  );
};
