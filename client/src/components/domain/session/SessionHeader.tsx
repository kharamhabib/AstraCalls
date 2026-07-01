import { useState, useRef, useEffect } from "react";
import { Loader2, Power, QrCode, Edit2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HistoryDrawer } from "@/components/domain/history/HistoryDrawer";
import { logoutSession, pairSession, renameSession } from "@/services/sessions";
import type { SessionInfo, SessionState } from "@/types/session";

const statusLabel: Record<SessionState, string> = {
  open: "Connected",
  qr: "Scan QR",
  connecting: "Connecting…",
  logged_out: "Disconnected",
};

const statusVariant: Record<SessionState, "success" | "secondary" | "muted" | "destructive"> = {
  open: "success",
  qr: "secondary",
  connecting: "muted",
  logged_out: "destructive",
};

export const SessionHeader = ({ session }: { session: SessionInfo }) => {
  const [busy, setBusy] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [newName, setNewName] = useState(session.name);
  const [renaming, setRenaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setNewName(session.name);
  }, [session.name]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      toast.error("O nome da sessão não pode ser vazio");
      return;
    }
    if (trimmed === session.name) {
      setIsEditing(false);
      return;
    }
    setRenaming(true);
    try {
      await renameSession(session.id, trimmed);
      setIsEditing(false);
      toast.success("Sessão renomeada com sucesso");
    } catch (e) {
      toast.error(`Erro ao renomear: ${(e as Error).message}`);
    } finally {
      setRenaming(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2.5">
        {isEditing ? (
          <div className="flex items-center gap-1.5 animate-fade-in-fast">
            <Input
              ref={inputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") setIsEditing(false);
              }}
              disabled={renaming}
              className="h-8 py-1 px-2 text-sm font-semibold max-w-[200px]"
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-primary hover:text-primary"
              onClick={handleSave}
              disabled={renaming}
            >
              {renaming ? <Loader2 key="loader" className="h-3 w-3 animate-spin" /> : <Check key="check" className="h-4 w-4" />}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground"
              onClick={() => setIsEditing(false)}
              disabled={renaming}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 group/title min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">{session.name}</h1>
            <button
              onClick={() => {
                setNewName(session.name);
                setIsEditing(true);
              }}
              className="text-muted-foreground/60 hover:text-foreground opacity-0 group-hover/title:opacity-100 transition-opacity p-1 cursor-pointer shrink-0"
              aria-label="Renomear sessão"
            >
              <Edit2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <Badge variant={statusVariant[session.state]}>{statusLabel[session.state]}</Badge>
      </div>
      <div className="flex items-center gap-2">
        {session.paired && <HistoryDrawer sid={session.id} />}
        {session.paired ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => run(() => logoutSession(session.id))}>
            {busy ? <Loader2 key="loader" className="h-4 w-4 animate-spin" /> : <Power key="power" className="h-4 w-4" />}
            <span>Disconnect</span>
          </Button>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => run(() => pairSession(session.id))}>
            {busy ? <Loader2 key="loader" className="h-4 w-4 animate-spin" /> : <QrCode key="qrcode" className="h-4 w-4" />}
            <span>Reactivate</span>
          </Button>
        )}
      </div>
    </div>
  );
};
