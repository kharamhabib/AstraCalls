import { useEffect, useRef, useState } from "react";
import { PhoneOff, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { attachMeter } from "@/lib/audio-meter";
import { useCalls } from "@/stores/calls";
import { useDevices } from "@/stores/devices";
import { useEndCall } from "@/hooks/useEndCall";
import { formatCallDuration } from "@/utils/format";
import type { CallStatus, CallSummary } from "@/types/call";
import { useAIAgents } from "@/stores/ai";
import { getAIConfig } from "@/services/ai";
import type { AIConfig } from "@/types/ai";
import { toast } from "sonner";

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
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

const EMPTY_TRANSCRIPT: any[] = [];

export const CallCard = ({ call }: { call: CallSummary }) => {
  const conn = useCalls((s) => s.ownConnections.get(call.callId));
  const outDeviceId = useDevices((s) => s.outId);
  const endCall = useEndCall();
  const [, force] = useState(0);
  const [micDb, setMicDb] = useState(-60);
  const [peerDb, setPeerDb] = useState(-60);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Estados e Stores da IA de Voz
  const [aiConfig, setAiConfig] = useState<AIConfig | null>(null);
  const [busyAI, setBusyAI] = useState(false);
  const isAIActive = useAIAgents((s) => s.activeAgentCalls.has(call.callId));
  const transcripts = useAIAgents((s) => s.transcripts[call.callId] || EMPTY_TRANSCRIPT);

  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Carrega a configuração da IA para esta sessão
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
        // Desativa a IA recuperando o microfone físico
        const agent = useAIAgents.getState().activeAgents.get(call.callId);
        if (agent) {
          await agent.detach();
        }
        useAIAgents.getState().setAgentInstance(call.callId, null);
        toast.info("IA de voz desconectada. Controle do microfone restaurado.");
      } else {
        // Ativa a IA passando o áudio para o Gemini Live
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
      // Fallback: garante desprendimento se falhar
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
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{call.peer}</p>
            <Badge variant={statusVariant[call.status]} className="mt-1">
              {formatCallDuration(call.startedAt, call.status)}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {conn && aiConfig && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={isAIActive ? "default" : "outline"}
                    size="icon"
                    disabled={busyAI}
                    onClick={toggleAI}
                    className={isAIActive ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}
                    aria-label={isAIActive ? "Desativar IA" : "Ativar IA"}
                  >
                    <Sparkles className={`h-4 w-4 ${isAIActive ? "animate-pulse fill-white/20" : "text-amber-500"}`} />
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
                  onClick={() => endCall.mutate({ sid: call.sessionId, callId: call.callId })}
                  aria-label="End call"
                >
                  <PhoneOff className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>End call</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <Meter label="Mic" db={micDb} />
        <Meter label="Peer" db={peerDb} />
        
        {/* Renderiza a transcrição da chamada em tempo real */}
        {transcripts.length > 0 && (
          <div className="mt-3 border-t pt-3 space-y-2 max-h-36 overflow-y-auto text-xs bg-muted/20 p-2 rounded-md font-sans">
            <p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-amber-500 fill-amber-500/10" /> Transcrição em tempo real
            </p>
            {transcripts.map((line, idx) => (
              <div key={idx} className={`leading-relaxed ${line.speaker === "ai" ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
                <span className="font-semibold uppercase text-[9px] mr-1">
                  {line.speaker === "ai" ? "IA:" : "Cliente:"}
                </span>
                {line.text}
              </div>
            ))}
          </div>
        )}

        <audio ref={audioRef} autoPlay muted={!!(aiConfig?.silenceOperator && isAIActive)} />
      </CardContent>
    </Card>
  );
};
