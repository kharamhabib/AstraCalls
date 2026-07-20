import { useEffect, useState, type ComponentType } from "react";
import { PlusCircle } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/components/layout/AppShell";
import { DashboardPage } from "@/pages/DashboardPage";
import { ConnectionsPage } from "@/pages/ConnectionsPage";
import { CallsPage } from "@/pages/CallsPage";
import { AgentsPage } from "@/pages/AgentsPage";
import { SettingsTab } from "@/components/domain/settings/SettingsTab";
import { SchedulesTab } from "@/components/domain/schedule/SchedulesTab";
import { WebphoneDrawer } from "@/components/domain/call/WebphoneDrawer";
import { IncomingCallModal } from "@/components/domain/call/IncomingCallModal";
import { EmptyState } from "@/components/shared/EmptyState";
import { ensureSessionsWired, useSessions } from "@/stores/sessions";
import { ensureCallsWired } from "@/stores/calls";
import { useNavigation } from "@/stores/navigation";
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
  const { activeSection } = useNavigation();
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
        {activeSection === "connections" ? (
          <ConnectionsPage />
        ) : sessions.length === 0 ? (
          <EmptyState
            icon={<PlusCircle className="h-6 w-6" />}
            title="Nenhuma conta conectada"
            description="Acesse a aba 'Conexões' para cadastrar sua primeira sessão do WhatsApp."
          />
        ) : active ? (
          <>
            {activeSection === "dashboard" && <DashboardPage sid={active.id} />}
            {activeSection === "calls" && <CallsPage sid={active.id} />}
            {activeSection === "schedules" && <SchedulesTab sid={active.id} />}
            {activeSection === "agents" && <AgentsPage sid={active.id} />}
            {activeSection === "settings" && <SettingsTab sid={active.id} />}
          </>
        ) : (
          <EmptyState title="Selecione uma conta" description="Escolha uma conta no menu superior ou lateral." />
        )}
      </AppShell>
      <WebphoneDrawer />
      <IncomingCallModal />
      <Toaster theme={theme} position="top-right" richColors closeButton />
      <DevAgentation />
    </TooltipProvider>
  );
};
