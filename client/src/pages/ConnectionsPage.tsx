import { useState } from "react";
import { Plus, Trash2, Smartphone, Loader2, LogOut, CheckCircle2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useSessions, setActiveSession } from "@/stores/sessions";
import { createSession, deleteSession, logoutSession } from "@/services/sessions";
import { SessionPairing } from "@/components/domain/session/SessionPairing";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import type { SessionInfo } from "@/types/session";
import { cn } from "@/lib/utils";

export const ConnectionsPage = () => {
  const sessions = useSessions((s) => s.sessions);
  const activeId = useSessions((s) => s.activeId);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<SessionInfo | null>(null);

  const onNewSession = async () => {
    setCreating(true);
    try {
      const { id } = await createSession("WhatsApp");
      setActiveSession(id);
      toast.success("Nova sessão criada com sucesso!");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const onRemoveSession = async (id: string) => {
    try {
      await deleteSession(id);
      toast.success("Sessão removida.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onLogout = async (id: string) => {
    try {
      await logoutSession(id);
      toast.success("Sessão desconectada.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border bg-card p-5 shadow-xs">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Gerenciador de Conexões WhatsApp</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Conecte e gerencie seus números de WhatsApp para chamadas de voz e IA.
          </p>
        </div>

        <Button onClick={onNewSession} disabled={creating} className="gap-2 rounded-xl shadow-xs">
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          <span>Nova Conexão</span>
        </Button>
      </div>

      {/* Grid of Sessions */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {sessions.map((s) => {
          const isActive = s.id === activeId;
          return (
            <div
              key={s.id}
              onClick={() => setActiveSession(s.id)}
              className={cn(
                "group relative flex flex-col justify-between rounded-2xl border bg-card p-5 shadow-xs transition-all duration-200 cursor-pointer",
                isActive ? "ring-2 ring-primary border-transparent shadow-md" : "hover:border-muted-foreground/30",
              )}
            >
              <div className="space-y-4">
                {/* Session Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary font-bold text-sm">
                      {s.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-base">{s.name}</h3>
                        {isActive && (
                          <span className="rounded-md bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
                            Ativa
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{s.jid ? s.jid.split("@")[0] : "Número pendente"}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="text-[10px] font-mono text-muted-foreground/75 bg-muted/60 px-1.5 py-0.5 rounded-md select-all">
                          SID: {s.id}
                        </span>
                        <button
                          type="button"
                          title="Copiar SID"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(s.id);
                            toast.success("SID copiado para a área de transferência!");
                          }}
                          className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted transition-colors"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {s.apiKey && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-[10px] font-mono text-muted-foreground/75 bg-muted/60 px-1.5 py-0.5 rounded-md">
                            API Key: {s.apiKey.slice(0, 6)}••••••••
                          </span>
                          <button
                            type="button"
                            title="Copiar API Key"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(s.apiKey);
                              toast.success("Chave de API da conexão copiada com sucesso!");
                            }}
                            className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted transition-colors"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {s.paired && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-amber-500"
                        title="Desconectar WhatsApp"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onLogout(s.id);
                        }}
                      >
                        <LogOut className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      title="Excluir Conexão"
                      onClick={(e) => {
                        e.stopPropagation();
                        setToDelete(s);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Connection Details or QR Pairing */}
                {s.paired ? (
                  <div className="flex items-center gap-2.5 rounded-xl border bg-emerald-500/10 p-3 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-5 w-5 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold">WhatsApp Conectado & Operacional</p>
                      <p className="text-[11px] opacity-80">Pronto para realizar e receber ligações.</p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border bg-muted/20 p-4">
                    <SessionPairing session={s} />
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {sessions.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed bg-card/40 p-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Smartphone className="h-6 w-6" />
            </div>
            <h3 className="mt-4 font-bold text-base">Nenhuma conexão cadastrada</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              Clique no botão acima para criar sua primeira conexão de WhatsApp.
            </p>
            <Button onClick={onNewSession} disabled={creating} className="mt-5 gap-2 rounded-xl">
              <Plus className="h-4 w-4" />
              <span>Criar Conexão</span>
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Excluir conexão?"
        description={toDelete ? `A conexão ${toDelete.name} será deslogada e removida.` : undefined}
        confirmLabel="Excluir"
        destructive
        onConfirm={() => {
          if (toDelete) void onRemoveSession(toDelete.id);
        }}
      />
    </div>
  );
};
