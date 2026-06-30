import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { setActiveSession, useSessions } from "@/stores/sessions";
import { createSession, deleteSession } from "@/services/sessions";
import type { SessionInfo, SessionState } from "@/types/session";

const dotClass: Record<SessionState, string> = {
  open: "bg-primary",
  qr: "bg-amber-500",
  connecting: "bg-muted-foreground/50",
  logged_out: "bg-destructive",
};

const statusLabel: Record<SessionState, string> = {
  open: "Online",
  qr: "QR Code",
  connecting: "Connecting",
  logged_out: "Offline",
};

/** Returns initials from a session name (first 2 chars, uppercase) */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export const Sidebar = ({ onNavigate }: { onNavigate?: () => void }) => {
  const sessions = useSessions((s) => s.sessions);
  const activeId = useSessions((s) => s.activeId);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<SessionInfo | null>(null);

  const onNew = async () => {
    setCreating(true);
    try {
      const { id } = await createSession("WhatsApp");
      setActiveSession(id);
      onNavigate?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteSession(id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <p className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Accounts
      </p>
      <div className="flex-1 space-y-1 overflow-y-auto custom-scrollbar">
        {sessions.map((s) => (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            onClick={() => {
              setActiveSession(s.id);
              onNavigate?.();
            }}
            className={cn(
              "group flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm transition-all duration-200",
              s.id === activeId
                ? "bg-accent text-accent-foreground shadow-sm"
                : "hover:bg-muted/60",
            )}
          >
            {/* Avatar with initials */}
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                s.id === activeId
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {getInitials(s.name)}
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-[13px]">{s.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass[s.state])} />
                <span className="text-[10px] text-muted-foreground">
                  {statusLabel[s.state]}
                </span>
                {s.jid && (
                  <>
                    <span className="text-[10px] text-muted-foreground/40">·</span>
                    <span className="truncate text-[10px] text-muted-foreground/70">
                      {s.jid.split("@")[0]}
                    </span>
                  </>
                )}
              </div>
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                setToDelete(s);
              }}
              className="text-muted-foreground opacity-0 transition-all duration-200 hover:text-destructive group-hover:opacity-100"
              aria-label={`Delete ${s.name}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {sessions.length === 0 && (
          <p className="px-2 py-4 text-center text-sm text-muted-foreground">
            No accounts yet.
          </p>
        )}
      </div>

      <Separator className="my-1" />

      <Button variant="outline" className="w-full gap-2" onClick={onNew} disabled={creating}>
        {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        New session
      </Button>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete account?"
        description={toDelete ? `${toDelete.name} will be logged out and removed.` : undefined}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (toDelete) void remove(toDelete.id);
        }}
      />
    </div>
  );
};
