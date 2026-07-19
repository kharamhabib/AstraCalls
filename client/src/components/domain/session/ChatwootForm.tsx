import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Loader2, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getChatwoot, setChatwoot, deleteChatwoot } from "@/services/chatwoot";

const empty = { url: "", account_id: "", account_token: "", inbox_id: "", inbox_identifier: "" };

type ChatwootFormProps = {
  sid: string;
  onEnabledChange?: (enabled: boolean) => void;
  onDone?: () => void; // chamado após salvar/desconectar (ex.: fechar dialog)
};

// ChatwootForm é o formulário único da integração Chatwoot, compartilhado pelo
// ChatwootDialog (modal por sessão) e pelo ChatwootSettingsPane (aba settings) —
// antes eram duas cópias quase idênticas.
export const ChatwootForm = ({ sid, onEnabledChange, onDone }: ChatwootFormProps) => {
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [webhookSecret, setWebhookSecret] = useState("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A URL do webhook carrega o token que autentica as chamadas do Chatwoot
  const webhookUrl =
    `${window.location.origin}/api/sessions/${sid}/chatwoot/webhook` +
    (webhookSecret ? `?token=${webhookSecret}` : "");

  useEffect(() => {
    setBusy(true);
    getChatwoot(sid)
      .then((r) => {
        setEnabled(r.enabled);
        onEnabledChange?.(r.enabled);
        const c = r.chatwoot || ({} as typeof r.chatwoot);
        setForm({
          url: c.url || "",
          account_id: c.account_id ? String(c.account_id) : "",
          account_token: "",
          inbox_id: c.inbox_id ? String(c.inbox_id) : "",
          inbox_identifier: c.inbox_identifier || "",
        });
        setWebhookSecret(c.webhook_secret || "");
      })
      .catch(() => {})
      .finally(() => setBusy(false));
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid]);

  const set = (k: keyof typeof empty) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const validate = (): string | null => {
    const url = form.url.trim();
    if (!/^https?:\/\/.+/.test(url)) return "URL do Chatwoot inválida (use http(s)://...)";
    const accountId = Number(form.account_id);
    if (!Number.isInteger(accountId) || accountId <= 0) return "Account ID deve ser um número inteiro positivo";
    const inboxId = Number(form.inbox_id);
    if (!Number.isInteger(inboxId) || inboxId <= 0) return "Inbox ID deve ser um número inteiro positivo";
    if (!enabled && !form.account_token.trim()) return "Access Token é obrigatório na primeira conexão";
    return null;
  };

  const save = async () => {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setBusy(true);
    try {
      await setChatwoot(sid, {
        url: form.url.trim(),
        account_id: Number(form.account_id),
        account_token: form.account_token.trim(),
        inbox_id: Number(form.inbox_id),
        inbox_identifier: form.inbox_identifier.trim(),
      });
      toast.success("Chatwoot conectado a esta sessão");
      setEnabled(true);
      onEnabledChange?.(true);
      // Recarrega para obter/atualizar o webhook_secret
      const r = await getChatwoot(sid).catch(() => null);
      if (r?.chatwoot?.webhook_secret) setWebhookSecret(r.chatwoot.webhook_secret);
      onDone?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await deleteChatwoot(sid);
      toast.success("Chatwoot desconectado");
      setEnabled(false);
      onEnabledChange?.(false);
      setForm({ ...empty });
      setWebhookSecret("");
      onDone?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    navigator.clipboard?.writeText(webhookUrl);
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>URL do Chatwoot</Label>
        <Input value={form.url} onChange={set("url")} placeholder="https://chatwoot.seudominio.com" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Account ID</Label>
          <Input value={form.account_id} onChange={set("account_id")} inputMode="numeric" placeholder="1" />
        </div>
        <div className="space-y-1">
          <Label>Inbox ID</Label>
          <Input value={form.inbox_id} onChange={set("inbox_id")} inputMode="numeric" placeholder="5" />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Access Token</Label>
        <Input
          value={form.account_token}
          onChange={set("account_token")}
          type="password"
          placeholder={enabled ? "deixe vazio p/ manter o atual" : "token do agente/admin"}
        />
      </div>
      <div className="space-y-1">
        <Label>Inbox Identifier</Label>
        <Input value={form.inbox_identifier} onChange={set("inbox_identifier")} placeholder="abcd1234" />
      </div>
      <div className="space-y-1">
        <Label>Webhook (cole na inbox do Chatwoot — já inclui o token de autenticação)</Label>
        <div className="flex gap-2">
          <Input readOnly value={webhookUrl} className="text-xs bg-muted/30" onFocus={(e) => e.target.select()} />
          <Button type="button" variant="outline" size="icon" onClick={copy} aria-label="Copiar webhook">
            {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="flex gap-2 justify-between pt-1">
        {enabled ? (
          <Button variant="destructive" size="sm" disabled={busy} onClick={disconnect}>
            Desconectar
          </Button>
        ) : (
          <span />
        )}
        <Button disabled={busy} onClick={save}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Salvar
        </Button>
      </div>
    </div>
  );
};
