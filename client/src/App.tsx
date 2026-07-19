import { useEffect, useState, type ComponentType } from "react";
import { PlusCircle } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/components/layout/AppShell";
import { CallsPage } from "@/pages/CallsPage";
import { SessionPairing } from "@/components/domain/session/SessionPairing";
import { SessionHeader } from "@/components/domain/session/SessionHeader";
import { IncomingCallModal } from "@/components/domain/call/IncomingCallModal";
import { EmptyState } from "@/components/shared/EmptyState";
import { ensureSessionsWired, useSessions } from "@/stores/sessions";
import { ensureCallsWired } from "@/stores/calls";
import { useTheme } from "@/stores/theme";
import { useAICallHandler } from "@/hooks/useAICallHandler";
import { useAICallScheduler } from "@/hooks/useAICallScheduler";

// Agentation é ferramenta de DEV: import dinâmico para não ir ao bundle de produção
const DevAgentation = (): React.ReactElement | null => {
  const [Comp, setComp] = useState<ComponentType | null>(null);
  useEffect(() => {
    if (import.meta.env.DEV) {
      import("agentation")
        .then((m) => setComp(() => m.Agentation))
        .catch(() => {});
    }
  }, []);
  if (!import.meta.env.DEV || !Comp) return null;
  return <Comp />;
};

export const App = () => {
  const sessions = useSessions((s) => s.sessions);
  const activeId = useSessions((s) => s.activeId);
  const theme = useTheme((s) => s.theme);

  // Ativa os hooks automáticos de IA e Agendamentos
  useAICallHandler();
  useAICallScheduler();

  useEffect(() => {
    ensureSessionsWired();
    ensureCallsWired();
  }, []);

  const active = sessions.find((s) => s.id === activeId) ?? null;

  return (
    <TooltipProvider delayDuration={200}>
      <AppShell>
        {sessions.length === 0 ? (
          <EmptyState
            icon={<PlusCircle className="h-6 w-6" />}
            title="Nenhuma conta ainda"
            description="Crie sua primeira conta WhatsApp na barra lateral para começar a ligar."
          />
        ) : active ? (
          <div className="space-y-4">
            <SessionHeader session={active} />
            {active.paired ? <CallsPage sid={active.id} /> : <SessionPairing session={active} />}
          </div>
        ) : (
          <EmptyState title="Selecione uma conta" description="Escolha uma conta na barra lateral." />
        )}
      </AppShell>
      <IncomingCallModal />
      <Toaster theme={theme} position="top-right" richColors closeButton />
      <DevAgentation />
    </TooltipProvider>
  );
};
