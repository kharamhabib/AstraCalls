import { useEffect, useRef } from "react";
import { useCalls } from "@/stores/calls";
import { useAcceptCall } from "./useAcceptCall";
import { useDevices } from "@/stores/devices";
import { getAIConfig } from "@/services/ai";
import { useAIAgents } from "@/stores/ai";
import { toast } from "sonner";
import { GeminiLiveAgent } from "@/lib/gemini-live";

export const useAICallHandler = () => {
  const incoming = useCalls((s) => s.incoming);
  const calls = useCalls((s) => s.calls);
  const ownConnections = useCalls((s) => s.ownConnections);
  const micId = useDevices((s) => s.micId);
  const acceptCallMutation = useAcceptCall(micId);

  // Evita re-atender a mesma chamada recebida consecutivamente
  const handledIncomingRef = useRef<string | null>(null);
  
  // Evita inicialização duplicada de agentes devido a múltiplas execuções concorrentes do useEffect
  const startingAgentsRef = useRef<Set<string>>(new Set());

  // 1. Monitora chamadas recebidas (Incoming) para Atendimento Automático
  useEffect(() => {
    if (!incoming || handledIncomingRef.current === incoming.callId) return;

    // Marca imediatamente como tratado para evitar chamadas de aceitar concorrentes durante a requisição HTTP
    handledIncomingRef.current = incoming.callId;

    const checkAndAutoAnswer = async () => {
      try {
        const { enabled, aiConfig } = await getAIConfig(incoming.sessionId);
        if (enabled && aiConfig && aiConfig.autoAnswer) {
          toast.info(`Chamada recebida de ${incoming.peer}. Atendendo automaticamente com IA...`);
          acceptCallMutation.mutate({
            sid: incoming.sessionId,
            callId: incoming.callId,
          });
        }
      } catch (e) {
        console.error("Erro ao verificar atendimento automático", e);
      }
    };

    void checkAndAutoAnswer();
  }, [incoming, acceptCallMutation]);

  // 2. Monitora chamadas conectadas para acoplar a IA de Voz (Atendimento ou Agendadas)
  useEffect(() => {
    const connectedCalls = calls.filter((c) => c.status === "connected");

    // Limpa chamadas antigas/finalizadas da referência de inicialização
    const connectedIds = new Set(connectedCalls.map((c) => c.callId));
    startingAgentsRef.current.forEach((id) => {
      if (!connectedIds.has(id)) {
        startingAgentsRef.current.delete(id);
      }
    });

    connectedCalls.forEach((call) => {
      const isAIActive = useAIAgents.getState().activeAgentCalls.has(call.callId);
      const isAIBusy = useAIAgents.getState().activeAgents.has(call.callId);
      const isStarting = startingAgentsRef.current.has(call.callId);
      const isScheduled = useAIAgents.getState().scheduledCallsInProgress.has(call.callId);

      // Se a chamada está ativa e a IA ainda não foi acoplada
      if (!isAIActive && !isAIBusy && !isStarting) {
        const conn = ownConnections.get(call.callId);
        if (conn && conn.remoteStream) {
          startingAgentsRef.current.add(call.callId); // Trava a inicialização para esta chamada

          void getAIConfig(call.sessionId).then(async ({ enabled, aiConfig }) => {
            // Acopla a IA se autoAnswer estiver ligado OU se for uma chamada agendada disparada pela IA
            if (enabled && aiConfig && (aiConfig.autoAnswer || isScheduled)) {
              try {
                // Remove do progresso de agendadas para não re-disparar
                if (isScheduled) {
                  useAIAgents.getState().removeScheduledInProgress(call.callId);
                }

                const agent = new GeminiLiveAgent(
                  call.callId,
                  conn.pc,
                  conn.micStream,
                  conn.remoteStream!,
                  aiConfig
                );
                useAIAgents.getState().setAgentInstance(call.callId, agent);
                await agent.start();
                toast.success("IA de voz acoplada com sucesso!");
              } catch (err) {
                console.error("Falha ao inicializar o agente de IA automático", err);
                useAIAgents.getState().setAgentInstance(call.callId, null);
                startingAgentsRef.current.delete(call.callId);
              }
            } else {
              // Se não for acoplar IA, libera a trava
              startingAgentsRef.current.delete(call.callId);
            }
          }).catch(() => {
            startingAgentsRef.current.delete(call.callId);
          });
        }
      }
    });
  }, [calls, ownConnections]);
};
