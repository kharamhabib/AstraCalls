import { useEffect, useState } from "react";
import { PhoneCall } from "lucide-react";
import { TabBar, type TabId } from "@/components/layout/TabBar";
import { Dialer } from "@/components/domain/call/Dialer";
import { CallCard } from "@/components/domain/call/CallCard";
import { OtherCallsList } from "@/components/domain/call/OtherCallsList";
import { SchedulesTab } from "@/components/domain/schedule/SchedulesTab";
import { SettingsTab } from "@/components/domain/settings/SettingsTab";
import { EmptyState } from "@/components/shared/EmptyState";
import { isMine, useCalls } from "@/stores/calls";
import { getAIConfig } from "@/services/ai";
import { parseScheduledCalls } from "@/lib/ai/scheduled-calls";

export const CallsPage = ({ sid }: { sid: string }) => {
  const calls = useCalls((s) => s.calls);
  const [activeTab, setActiveTab] = useState<TabId>("dialer");
  const [pendingCount, setPendingCount] = useState(0);

  // Fetch schedule badge count
  useEffect(() => {
    getAIConfig(sid)
      .then((r) => {
        const schedules = parseScheduledCalls(r.aiConfig?.scheduledCalls);
        const pending = schedules.filter((s) => s.active && new Date(s.time) > new Date());
        setPendingCount(pending.length);
      })
      .catch(() => {});
  }, [sid, activeTab]);

  const sessionCalls = calls.filter((c) => c.sessionId === sid && c.status !== "ended");
  const mine = sessionCalls.filter(isMine);
  const others = sessionCalls.filter((c) => !isMine(c));

  return (
    <div className="space-y-0">
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} scheduleBadge={pendingCount} />

      <div className="px-4 py-6 sm:px-6">
        {activeTab === "dialer" && (
          <div className="mx-auto max-w-3xl space-y-5 animate-fade-in">
            <Dialer sid={sid} />
            {mine.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 stagger-children">
                {mine.map((c) => (
                  <CallCard key={c.callId} call={c} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<PhoneCall className="h-6 w-6" />}
                title="Nenhuma chamada ativa"
                description="Disque um número acima para iniciar uma chamada."
              />
            )}
            <OtherCallsList calls={others} />
          </div>
        )}

        {activeTab === "schedules" && <SchedulesTab sid={sid} />}
        {activeTab === "settings" && <SettingsTab sid={sid} />}
      </div>
    </div>
  );
};
