import { useRef, useEffect, useState, type ReactNode } from "react";
import { Phone, CalendarClock, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabId = "dialer" | "schedules" | "settings";

interface Tab {
  id: TabId;
  label: string;
  icon: ReactNode;
  badge?: number;
}

const tabs: Tab[] = [
  { id: "dialer", label: "Discador", icon: <Phone className="h-4 w-4" /> },
  { id: "schedules", label: "Agendamentos", icon: <CalendarClock className="h-4 w-4" /> },
  { id: "settings", label: "Configurações", icon: <Settings className="h-4 w-4" /> },
];

interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  scheduleBadge?: number;
}

export const TabBar = ({ activeTab, onTabChange, scheduleBadge }: TabBarProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const activeEl = container.querySelector<HTMLButtonElement>(`[data-tab="${activeTab}"]`);
    if (!activeEl) return;
    setIndicator({
      left: activeEl.offsetLeft,
      width: activeEl.offsetWidth,
    });
  }, [activeTab]);

  return (
    <div className="relative border-b bg-card/50">
      <div ref={containerRef} className="mx-auto flex max-w-3xl" role="tablist">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          const badge = tab.id === "schedules" ? scheduleBadge : undefined;
          return (
            <button
              key={tab.id}
              data-tab={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "relative flex flex-1 items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors duration-200",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
              {badge != null && badge > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {/* Animated underline indicator */}
      <span
        className="tab-indicator absolute bottom-0 h-0.5 rounded-full bg-primary"
        style={{ left: indicator.left, width: indicator.width }}
        aria-hidden
      />
    </div>
  );
};
