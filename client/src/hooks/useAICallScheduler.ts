import { useEffect } from "react";
import { useSessions } from "@/stores/sessions";
import { useStartCall } from "./useStartCall";
import { useDevices } from "@/stores/devices";
import { getAIConfig, setAIConfig } from "@/services/ai";
import { useAIAgents } from "@/stores/ai";
import { useCalls } from "@/stores/calls";
import { parseScheduledCalls } from "@/lib/ai/scheduled-calls";
import { toast } from "sonner";

export const useAICallScheduler = () => {
  const activeId = useSessions((s) => s.activeId);
  const micId = useDevices((s) => s.micId);
  const startCallMutation = useStartCall(activeId || "", micId);

  // Carrega e gerencia a configuração ativa do Zustand
  const activeConfig = useAIAgents((s) => s.activeSessionConfig);
  const setActiveConfig = useAIAgents((s) => s.setActiveSessionConfig);

  // Carrega as configurações de IA ao mudar de sessão
  useEffect(() => {
    if (!activeId) {
      setActiveConfig(null);
      return;
    }

    getAIConfig(activeId)
      .then((r) => {
        if (r.aiConfig) {
          setActiveConfig(r.aiConfig);
        } else {
          setActiveConfig(null);
        }
      })
      .catch((err) => {
        console.error("[useAICallScheduler] Erro ao carregar config de IA:", err);
        setActiveConfig(null);
      });
  }, [activeId, setActiveConfig]);

  // Monitora e dispara agendamentos a cada 10 segundos
  useEffect(() => {
    if (!activeId || !activeConfig) return;

    const interval = setInterval(() => {
      // Se a IA autônoma no servidor está ativada, o Go scheduler cuida dos agendamentos
      if (activeConfig.serverSideAI) return;

      // Evita disparar agendamentos se já houver qualquer chamada ativa ou recebida tocando
      const activeCalls = useCalls.getState().calls;
      const incoming = useCalls.getState().incoming;
      if (activeCalls.length > 0 || incoming !== null) {
        return;
      }

      const schedules = parseScheduledCalls(activeConfig.scheduledCalls);

      const activeSchedules = schedules.filter((s) => s.active);
      if (activeSchedules.length === 0) return;

      const now = new Date();
      // Encontra a primeira chamada cujo horário já passou
      const toTrigger = activeSchedules.find((s) => new Date(s.time) <= now);

      if (toTrigger) {
        console.log("[useAICallScheduler] Disparando agendamento automático para:", toTrigger.phone);
        toast.info(`Disparando ligação programada automática para ${toTrigger.phone}...`);

        // Marca o agendamento como inativo (concluído) em vez de excluir
        const nextSchedules = schedules.map((s) =>
          s.id === toTrigger.id ? { ...s, active: false } : s
        );
        const nextConfig = {
          ...activeConfig,
          scheduledCalls: JSON.stringify(nextSchedules),
        };

        // Atualiza o estado na store e persiste no banco
        setActiveConfig(nextConfig);
        void setAIConfig(activeId, nextConfig).catch((e) => {
          console.error("[useAICallScheduler] Falha ao salvar agendamentos após disparo", e);
        });

        // Efetua a ligação ativa
        void startCallMutation
          .mutateAsync({ phone: toTrigger.phone, record: false })
          .then((callId) => {
            console.log("[useAICallScheduler] Chamada programada disparada com sucesso! ID:", callId);
            // Registra o prompt complementar se houver
            if (toTrigger.prompt) {
              useAIAgents.getState().setCustomPrompt(callId, toTrigger.prompt);
            }
            // Sinaliza para o hook useAICallHandler que a IA deve assumir esta chamada assim que ela conectar
            useAIAgents.getState().addScheduledInProgress(callId);

            // Vincula o callId gerado ao agendamento inativado
            getAIConfig(activeId).then(({ enabled, aiConfig }) => {
              if (enabled && aiConfig) {
                const currentSchedules = parseScheduledCalls(aiConfig.scheduledCalls);
                const updated = currentSchedules.map((s) =>
                  s.id === toTrigger.id ? { ...s, callId } : s
                );
                const nextConfig = {
                  ...aiConfig,
                  scheduledCalls: JSON.stringify(updated),
                };
                setActiveConfig(nextConfig);
                setAIConfig(activeId, nextConfig).catch(() => {});
              }
            }).catch(() => {});
          })
          .catch((err) => {
            console.error("[useAICallScheduler] Falha ao disparar chamada agendada:", err);
            toast.error(`Falha ao disparar ligação agendada: ${err.message}`);
          });
      }
    }, 10000);

    return () => {
      clearInterval(interval);
    };
  }, [activeId, activeConfig, startCallMutation, setActiveConfig]);
};
