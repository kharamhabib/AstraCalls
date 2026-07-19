import { useEffect, useRef } from "react";
import { useCalls } from "@/stores/calls";
import { useAcceptCall } from "./useAcceptCall";
import { useDevices } from "@/stores/devices";
import { getAIConfig } from "@/services/ai";
import { useAIAgents } from "@/stores/ai";
import { toast } from "sonner";
// Import dinâmico: o módulo do Gemini (~40KB) não entra no bundle inicial
// (CallCard também usa import() — manter o mesmo padrão nos dois).

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

  // Timer do auto-atendimento com delay (cancelável se a chamada mudar de estado)
  const autoAnswerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 1. Monitora chamadas recebidas (Incoming) para Atendimento Automático
  useEffect(() => {
    if (!incoming || handledIncomingRef.current === incoming.callId) return;

    // Marca imediatamente como tratado para evitar chamadas de aceitar concorrentes durante a requisição HTTP
    handledIncomingRef.current = incoming.callId;

    const checkAndAutoAnswer = async () => {
      try {
        const { enabled, aiConfig } = await getAIConfig(incoming.sessionId);
        // Se a IA autônoma no servidor está ativada, o Go cuida do auto-atendimento
        if (enabled && aiConfig && aiConfig.serverSideAI) return;
        if (enabled && aiConfig && aiConfig.autoAnswer) {
          const delay = aiConfig.autoAnswerDelay ? aiConfig.autoAnswerDelay * 1000 : 0;

          const answerFn = () => {
            autoAnswerTimerRef.current = null;
            // Verifica se a chamada ainda está tocando/pendente e se o operador não atendeu
            const currentIncoming = useCalls.getState().incoming;
            if (currentIncoming && currentIncoming.callId === incoming.callId) {
              toast.info(`Atendendo automaticamente com IA...`);
              acceptCallMutation.mutate({
                sid: incoming.sessionId,
                callId: incoming.callId,
              });
            }
          };

          if (delay > 0) {
            if (autoAnswerTimerRef.current) clearTimeout(autoAnswerTimerRef.current);
            autoAnswerTimerRef.current = setTimeout(answerFn, delay);
          } else {
            toast.info(`Chamada recebida de ${incoming.peer}. Atendendo automaticamente com IA...`);
            answerFn();
          }
        }
      } catch (e) {
        console.error("Erro ao verificar atendimento automático", e);
      }
    };

    void checkAndAutoAnswer();
  }, [incoming, acceptCallMutation]);

  // Cancela o timer de auto-atendimento se a chamada sair do estado "incoming"
  useEffect(() => {
    if (!incoming && autoAnswerTimerRef.current) {
      clearTimeout(autoAnswerTimerRef.current);
      autoAnswerTimerRef.current = null;
    }
  }, [incoming]);

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
            // Se a IA autônoma no servidor está ativada, o Go já gerencia o agente de voz
            if (enabled && aiConfig && aiConfig.serverSideAI) {
              startingAgentsRef.current.delete(call.callId);
              return;
            }
            // Acopla a IA se:
            // - For chamada INBOUND e autoAnswer estiver ligado
            // - OU for uma chamada agendada/outbound explicitamente disparada com IA (isScheduled)
            const shouldAttachAI = isScheduled || (aiConfig.autoAnswer && call.direction === "inbound");
            if (enabled && aiConfig && shouldAttachAI) {
              try {
                // Remove do progresso de agendadas para não re-disparar
                if (isScheduled) {
                  useAIAgents.getState().removeScheduledInProgress(call.callId);
                }

                const { GeminiLiveAgent } = await import("@/lib/gemini-live");
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
