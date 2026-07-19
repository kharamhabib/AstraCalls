import { useEffect, useRef, useState } from "react";
import { PhoneOff, Sparkles, PhoneIncoming, PhoneOutgoing, Mic, Volume2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { attachMeter } from "@/lib/audio-meter";
import { useNow } from "@/lib/use-now";
import { useCalls } from "@/stores/calls";
import { useDevices } from "@/stores/devices";
import { useEndCall } from "@/hooks/useEndCall";
import { formatCallDuration, formatPhoneNumber } from "@/utils/format";
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

const AudioMeterBar = ({ label, icon: Icon, db }: { label: string; icon: any; db: number }) => {
  const pct = Math.max(0, Math.min(100, Math.round(((db + 60) / 60) * 100)));
  return (
    <div className="space-y-1.5 flex-1">
      <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
        <span className="flex items-center gap-1">
          <Icon className="h-3 w-3 text-primary" />
          <span>{label}</span>
        </span>
        <span className="font-mono text-[10px] opacity-75">{pct > 0 ? `${pct}%` : "mudo"}</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-muted/60"
        role="progressbar"
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn(
            "h-full rounded-full transition-all duration-150",
            pct > 40
              ? "bg-gradient-to-r from-emerald-500 to-teal-400"
              : pct > 10
              ? "bg-gradient-to-r from-primary/70 to-primary"
              : "bg-muted-foreground/30",
          )}
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
  const transcriptContainerRef = useRef<HTMLDivElement>(null);

  const { data: contact } = useContactInfo(call.sessionId, call.peer);

  const displayPhone = formatPhoneNumber(contact?.phone || call.peer);
  const displayName = contact?.name && contact.name !== contact.phone ? contact.name : displayPhone;
  const hasContactName = Boolean(contact?.name && contact.name !== contact.phone);

  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [transcripts]);

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
        const agent = new GeminiLiveAgent(call.callId, conn.pc, conn.micStream, remoteStream, aiConfig);
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

  const isInbound = call.direction === "inbound";
  const DirectionIcon = isInbound ? PhoneIncoming : PhoneOutgoing;

  return (
    <Card className="rounded-2xl border bg-card/90 shadow-md backdrop-blur-xs transition-all hover:shadow-lg">
      <CardContent className="space-y-4 p-5">
        {/* Header Info */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3.5 min-w-0">
            {/* Avatar Profile */}
            <div className="relative shrink-0">
              {contact?.pictureUrl ? (
                <img
                  src={contact.pictureUrl}
                  alt={displayName}
                  className="h-12 w-12 rounded-2xl object-cover border shadow-xs"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary font-extrabold text-sm border border-primary/20">
                  {getInitials(displayName)}
                </div>
              )}
              <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-background p-0.5 shadow-xs">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
              </span>
            </div>

            {/* Contact Details */}
            <div className="min-w-0 space-y-0.5">
              <h4 className="truncate font-extrabold text-base text-foreground leading-tight" title={displayName}>
                {displayName}
              </h4>

              {hasContactName && (
                <p className="text-xs font-semibold text-muted-foreground font-mono truncate">{displayPhone}</p>
              )}

              <div className="flex items-center gap-2 pt-0.5 flex-wrap">
                <Badge variant={statusVariant[call.status]} className="h-5 text-[10px] px-2 font-bold rounded-md">
                  {formatCallDuration(call.startedAt, call.status)}
                </Badge>

                <span className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                  <DirectionIcon className="h-3 w-3 text-primary" />
                  <span>{isInbound ? "Recebida" : "Efetuada"}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Action Control Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {conn && aiConfig && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={isAIActive ? "default" : "outline"}
                    size="sm"
                    disabled={busyAI}
                    onClick={toggleAI}
                    className={cn(
                      "h-9 gap-1.5 rounded-xl font-bold text-xs transition-all",
                      isAIActive
                        ? "bg-amber-500 hover:bg-amber-600 text-white shadow-md animate-pulse"
                        : "hover:bg-primary/10",
                    )}
                  >
                    <Sparkles className="h-4 w-4" />
                    <span className="hidden sm:inline">{isAIActive ? "IA Ativa" : "Ativar IA"}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{isAIActive ? "Desativar IA nesta chamada" : "Conectar IA nesta chamada"}</TooltipContent>
              </Tooltip>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() => endCall.mutate({ sid: call.sessionId, callId: call.callId })}
                  className="h-9 w-9 rounded-xl shadow-xs"
                  aria-label="Encerrar chamada"
                >
                  <PhoneOff className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Desligar Chamada</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Auto Answer Countdown (if applicable) */}
        {call.status === "ringing" &&
          call.direction === "inbound" &&
          aiConfig?.autoAnswer &&
          (aiConfig.autoAnswerDelay ?? 0) > 0 && (
            (() => {
              const remaining = Math.max(0, Math.ceil((call.startedAt + aiConfig.autoAnswerDelay * 1000 - Date.now()) / 1000));
              if (remaining <= 0) return null;
              return (
                <div className="rounded-xl bg-amber-500/10 px-3.5 py-2 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-300 font-semibold animate-pulse flex items-center justify-between">
                  <span>Atendimento automático IA em:</span>
                  <span className="font-extrabold text-sm tabular-nums">{remaining}s</span>
                </div>
              );
            })()
          )}

        {/* Audio VU Meters (Mic & Peer) */}
        <div className="flex items-center gap-4 rounded-xl border bg-muted/20 p-3">
          <AudioMeterBar label="Microfone / IA" icon={Mic} db={micDb} />
          <div className="h-6 w-px bg-border shrink-0" />
          <AudioMeterBar label="Áudio Cliente" icon={Volume2} db={peerDb} />
        </div>

        {/* Real-time Transcript Snippet Box */}
        {transcripts.length > 0 && (
          <div ref={transcriptContainerRef} className="rounded-xl border bg-muted/20 p-3 space-y-2.5 max-h-48 overflow-y-auto custom-scrollbar animate-fade-in">
            <p className="font-bold text-[11px] text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span>Transcrição ao Vivo</span>
            </p>
            <div className="space-y-2">
              {transcripts.map((line, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "flex flex-col gap-1 w-full animate-fade-in-fast",
                    line.speaker === "ai" ? "items-end" : "items-start",
                  )}
                >
                  <span className="text-[9px] font-extrabold text-muted-foreground uppercase px-1">
                    {line.speaker === "ai" ? "IA" : "Cliente"}
                  </span>
                  <div
                    className={cn(
                      "rounded-2xl px-3 py-2 text-xs shadow-xs max-w-[85%] leading-relaxed border break-words font-medium",
                      line.speaker === "ai"
                        ? "bg-primary text-primary-foreground rounded-tr-none"
                        : "bg-card text-foreground border-border rounded-tl-none",
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
