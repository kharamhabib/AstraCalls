import { useEffect } from "react";
import { useSessions } from "@/stores/sessions";
import { useStartCall } from "./useStartCall";
import { useDevices } from "@/stores/devices";
import { getAIConfig, setAIConfig } from "@/services/ai";
import { useAIAgents } from "@/stores/ai";
import { useCalls } from "@/stores/calls";
import type { ScheduledCall } from "@/types/ai";
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
      // Evita disparar agendamentos se já houver qualquer chamada ativa ou recebida tocando
      const activeCalls = useCalls.getState().calls;
      const incoming = useCalls.getState().incoming;
      if (activeCalls.length > 0 || incoming !== null) {
        return;
      }

      let schedules: ScheduledCall[] = [];
      try {
        schedules = JSON.parse(activeConfig.scheduledCalls || "[]");
      } catch (e) {
        console.error("[useAICallScheduler] Erro ao fazer parse de scheduledCalls JSON:", e);
        return;
      }

      const activeSchedules = schedules.filter((s) => s.active);
      if (activeSchedules.length === 0) return;

      const now = new Date();
      // Encontra a primeira chamada cujo horário já passou
      const toTrigger = activeSchedules.find((s) => new Date(s.time) <= now);

      if (toTrigger) {
        console.log("[useAICallScheduler] Disparando agendamento automático para:", toTrigger.phone);
        toast.info(`Disparando ligação programada automática para ${toTrigger.phone}...`);

        // Remove o agendamento disparado da lista local (agendamento de disparo único)
        const nextSchedules = schedules.filter((s) => s.id !== toTrigger.id);
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
