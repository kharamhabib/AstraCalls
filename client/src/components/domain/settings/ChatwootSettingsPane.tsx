import { useEffect, useState, type ChangeEvent } from "react";
import { MessageSquare, Loader2, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { getChatwoot, setChatwoot, deleteChatwoot } from "@/services/chatwoot";

const empty = { url: "", account_id: "", account_token: "", inbox_id: "", inbox_identifier: "" };

export const ChatwootSettingsPane = ({ sid }: { sid: string }) => {
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({ ...empty });

  const webhookUrl = `${window.location.origin}/api/sessions/${sid}/chatwoot/webhook`;

  useEffect(() => {
    setBusy(true);
    getChatwoot(sid)
      .then((r) => {
        setEnabled(r.enabled);
        const c = r.chatwoot || ({} as typeof r.chatwoot);
        setForm({
          url: c.url || "",
          account_id: c.account_id ? String(c.account_id) : "",
          account_token: "",
          inbox_id: c.inbox_id ? String(c.inbox_id) : "",
          inbox_identifier: c.inbox_identifier || "",
        });
      })
      .catch(() => {})
      .finally(() => setBusy(false));
  }, [sid]);

  const set = (k: keyof typeof empty) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
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
      setForm({ ...empty });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    navigator.clipboard?.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-5 animate-fade-in relative">
      {busy && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-50 rounded-lg">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {/* Status indicator */}
      <div className="flex items-center gap-2 px-1">
        <MessageSquare className="h-4 w-4 text-blue-500" />
        <span className="text-sm font-medium">Integração com Chatwoot</span>
        <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${
          enabled ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
        }`}>
          {enabled ? "Conectado" : "Desconectado"}
        </span>
      </div>

      <p className="text-sm text-muted-foreground px-1">
        Conecte esta sessão a uma caixa de entrada (inbox do tipo <b>API</b>) do Chatwoot.
      </p>

      <Card className="card-premium">
        <CardContent className="p-4 space-y-4">
          <div className="space-y-1.5">
            <Label>URL do Chatwoot</Label>
            <Input value={form.url} onChange={set("url")} placeholder="https://chatwoot.seudominio.com" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Account ID</Label>
              <Input value={form.account_id} onChange={set("account_id")} inputMode="numeric" placeholder="1" />
            </div>
            <div className="space-y-1.5">
              <Label>Inbox ID</Label>
              <Input value={form.inbox_id} onChange={set("inbox_id")} inputMode="numeric" placeholder="5" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Access Token</Label>
            <Input
              value={form.account_token}
              onChange={set("account_token")}
              type="password"
              placeholder={enabled ? "deixe vazio p/ manter o atual" : "token do agente/admin"}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Inbox Identifier</Label>
            <Input value={form.inbox_identifier} onChange={set("inbox_identifier")} placeholder="abcd1234" />
          </div>

          <div className="space-y-1.5">
            <Label>Webhook (cole na inbox do Chatwoot)</Label>
            <div className="flex gap-2">
              <Input readOnly value={webhookUrl} className="text-xs bg-muted/30" onFocus={(e) => e.target.select()} />
              <Button type="button" variant="outline" size="icon" onClick={copy} aria-label="Copiar webhook">
                {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
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
