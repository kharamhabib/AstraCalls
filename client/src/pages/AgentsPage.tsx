import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Plus, Bot, Pencil, Trash2, Loader2, ZapIcon, Radio, PhoneIncoming, PhoneOutgoing, X, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  listAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  activateAgent,
  deactivateAgent,
  type Agent,
  type AgentUpsert,
} from "@/services/agents";

const VOICES = ["Puck", "Charon", "Kore", "Fenrir", "Aoede", "Orbit", "Zephyr", "Leda"];

const RoleBadge = ({ role }: { role: Agent["role"] }) => {
  const cfg = {
    inbound: { icon: PhoneIncoming, label: "Receptivo", class: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20" },
    outbound: { icon: PhoneOutgoing, label: "Ativo", class: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
    both: { icon: Radio, label: "Ambos", class: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  }[role];
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold", cfg.class)}>
      <Icon className="h-3 w-3" /> {cfg.label}
    </span>
  );
};

const DeleteModal = ({ name, onConfirm, onCancel, busy }: { name: string; onConfirm: () => void; onCancel: () => void; busy: boolean }) => 
  createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-2xl space-y-4 mx-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div>
            <h3 className="font-semibold text-sm">Excluir agente</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Tem certeza que deseja excluir o agente <strong>"{name}"</strong>? Esta ação não pode ser desfeita.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>Cancelar</Button>
          <Button variant="destructive" size="sm" onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            Excluir
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );

const AgentForm = ({
  initial,
  onSave,
  onCancel,
  busy,
}: {
  initial: Partial<AgentUpsert> | null;
  onSave: (data: AgentUpsert) => void;
  onCancel: () => void;
  busy: boolean;
}) => {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [role, setRole] = useState<Agent["role"]>(initial?.role ?? "both");
  const [instruction, setInstruction] = useState(initial?.aiConfig?.systemInstruction ?? "");
  const [voice, setVoice] = useState(initial?.aiConfig?.voiceName ?? "Puck");
  const [geminiKey, setGeminiKey] = useState(initial?.aiConfig?.geminiApiKey ?? "");

  const submit = () => {
    if (!name.trim()) { toast.error("Nome do agente é obrigatório"); return; }
    onSave({
      name: name.trim(),
      description: description.trim(),
      role,
      isActive: initial?.isActive ?? false,
      aiConfig: {
        systemInstruction: instruction,
        voiceName: voice,
        languageCode: "pt-BR",
        temperature: 1.0,
        toolsEnabled: true,
        predefinedTools: ["hangup", "transfer_to_agent"],
        geminiApiKey: geminiKey.trim(),
      },
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in p-4">
      <div className="w-full max-w-lg rounded-2xl border bg-card shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="font-semibold text-sm">{initial?.name ? `Editar Agente: ${initial.name}` : "Novo Agente"}</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCancel}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Nome do Agente *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Suporte Técnico"
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Especialidade / Descrição</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: Especialista em problemas de hardware"
              />
            </div>
          </div>

          {/* Role picker */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">Tipo de Chamada</Label>
            <div className="flex gap-2">
              {(["inbound", "outbound", "both"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-all",
                    role === r
                      ? "border-primary bg-primary/10 text-primary font-semibold"
                      : "text-muted-foreground hover:bg-muted/60"
                  )}
                >
                  {r === "inbound" ? "Receptivo" : r === "outbound" ? "Ativo" : "Ambos"}
                </button>
              ))}
            </div>
          </div>

          {/* Voice */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">Voz da IA</Label>
            <div className="grid grid-cols-4 gap-1.5">
              {VOICES.map((v) => (
                <button
                  key={v}
                  onClick={() => setVoice(v)}
                  className={cn(
                    "rounded-lg border px-2 py-1.5 text-xs font-medium transition-all",
                    voice === v
                      ? "border-primary bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/60"
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Gemini API Key (optional) */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">Gemini API Key (opcional — usa chave global)</Label>
            <Input
              type="password"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              placeholder="AIza... deixe em branco para herdar"
            />
          </div>

          {/* System instruction */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">Instrução do Sistema</Label>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={8}
              className="w-full rounded-lg border bg-background px-3 py-2 text-xs font-mono leading-relaxed focus:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
              placeholder="Você é um especialista em suporte técnico de hardware..."
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>Cancelar</Button>
          <Button size="sm" onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
            Salvar Agente
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export const AgentsPage = ({ sid }: { sid: string }) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [deleting, setDeleting] = useState<Agent | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    listAgents(sid)
      .then(setAgents)
      .catch(() => toast.error("Falha ao carregar agentes"))
      .finally(() => setLoading(false));
  }, [sid]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (data: AgentUpsert) => {
    setSaveBusy(true);
    try {
      if (editing) {
        await updateAgent(sid, editing.id, data);
        toast.success("Agente atualizado!");
      } else {
        await createAgent(sid, data);
        toast.success("Agente criado com sucesso!");
      }
      setFormOpen(false);
      setEditing(null);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaveBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await deleteAgent(sid, deleting.id);
      toast.success(`Agente "${deleting.name}" excluído`);
      setDeleting(null);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  };

  const toggleActivate = async (agent: Agent, direction: "inbound" | "outbound") => {
    try {
      const isActive = agent.isActive;
      if (isActive) {
        await deactivateAgent(sid, agent.id, direction);
      } else {
        await activateAgent(sid, agent.id, direction);
      }
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Agentes de IA</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Gerencie personas e especialistas para esta conexão. A IA pode transferir chamadas entre agentes.
          </p>
        </div>
        <Button
          size="sm"
          className="shrink-0"
          onClick={() => { setEditing(null); setFormOpen(true); }}
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Novo Agente
        </Button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : agents.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card/40 py-16 flex flex-col items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
            <Bot className="h-7 w-7 text-muted-foreground" />
          </div>
          <div className="text-center space-y-1">
            <p className="font-semibold text-sm">Nenhum agente cadastrado</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Crie agentes especialistas. A IA principal pode transferir chamadas para eles automaticamente.
            </p>
          </div>
          <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus className="h-4 w-4 mr-1.5" />
            Criar primeiro agente
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="rounded-xl border bg-card p-4 flex items-start gap-4 transition-all hover:shadow-sm"
            >
              {/* Icon */}
              <div className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                agent.isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              )}>
                <Bot className="h-5 w-5" />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{agent.name}</span>
                  <RoleBadge role={agent.role} />
                  {agent.isActive && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 px-2 py-0.5 text-[11px] font-semibold">
                      <ZapIcon className="h-2.5 w-2.5" /> Ativo
                    </span>
                  )}
                </div>
                {agent.description && (
                  <p className="text-xs text-muted-foreground">{agent.description}</p>
                )}
                <p className="text-[10px] font-mono text-muted-foreground/60 select-all">ID: {agent.id}</p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  size="sm"
                  variant={agent.isActive ? "outline" : "secondary"}
                  className="h-8 px-3 text-xs"
                  onClick={() => toggleActivate(agent, agent.role === "outbound" ? "outbound" : "inbound")}
                >
                  {agent.isActive ? "Desativar" : "Ativar"}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => { setEditing(agent); setFormOpen(true); }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleting(agent)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {formOpen && (
        <AgentForm
          initial={editing ? { ...editing } : null}
          onSave={handleSave}
          onCancel={() => { setFormOpen(false); setEditing(null); }}
          busy={saveBusy}
        />
      )}
      {deleting && (
        <DeleteModal
          name={deleting.name}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
          busy={deleteBusy}
        />
      )}
    </div>
  );
};
