import { LayoutDashboard, Radio, PhoneCall, Calendar, Settings, PhoneForwarded, Bot } from "lucide-react";
import { useNavigation, type NavSection } from "@/stores/navigation";
import { useSessions } from "@/stores/sessions";
import { cn } from "@/lib/utils";

const navItems: { id: NavSection; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Início", icon: LayoutDashboard },
  { id: "connections", label: "Conexões", icon: Radio },
  { id: "calls", label: "Chamadas", icon: PhoneCall },
  { id: "schedules", label: "Agendamentos", icon: Calendar },
  { id: "agents", label: "Agentes IA", icon: Bot },
  { id: "settings", label: "Ajustes", icon: Settings },
];

export const Sidebar = ({ onNavigate }: { onNavigate?: () => void }) => {
  const { activeSection, setActiveSection } = useNavigation();
  const sessions = useSessions((s) => s.sessions);
  const activeId = useSessions((s) => s.activeId);

  const activeSession = sessions.find((s) => s.id === activeId);

  return (
    <div className="flex h-full flex-col justify-between p-4 bg-sidebar text-sidebar-foreground">
      <div className="space-y-6">
        {/* Brand Header */}
        <div className="flex items-center gap-3 px-2 py-1">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md">
            <PhoneForwarded className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-foreground">Kallia</h1>
            <p className="text-[11px] font-medium text-muted-foreground">PABX IA WhatsApp</p>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveSection(item.id);
                  onNavigate?.();
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-200",
                  isActive
                    ? "bg-primary/10 text-primary shadow-sm font-semibold"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icon className={cn("h-4 w-4 transition-transform duration-200", isActive && "scale-110 text-primary")} />
                <span>{item.label}</span>
                {item.id === "connections" && sessions.length > 0 && (
                  <span className="ml-auto rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
                    {sessions.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Active Account Info Card at bottom */}
      {activeSession && (
        <div className="rounded-2xl border bg-card/60 p-3 shadow-xs backdrop-blur-xs">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5 px-0.5">
            Conta Ativa
          </p>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-bold shrink-0">
              {activeSession.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{activeSession.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full shrink-0",
                    activeSession.state === "open"
                      ? "bg-emerald-500"
                      : activeSession.state === "qr"
                      ? "bg-amber-500 animate-pulse"
                      : "bg-red-500",
                  )}
                />
                <span className="text-[11px] text-muted-foreground capitalize">
                  {activeSession.state === "open" ? "Conectado" : activeSession.state === "qr" ? "Aguardando QR" : "Desconectado"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
