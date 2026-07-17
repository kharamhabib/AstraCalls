import { useState } from "react";
import { Loader2, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setAuth } from "@/lib/auth";

export const LoginScreen = ({ onSuccess }: { onSuccess: () => void }) => {
  const [url, setUrl] = useState(window.location.origin);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setBusy(true);
    setErr("");
    const base = url.replace(/\/+$/, "");
    try {
      const r = await fetch(`${base}/api/config`, { headers: { "X-API-Key": key } });
      if (!r.ok) {
        setErr(r.status === 401 ? "API key inválida" : `Erro ${r.status}`);
        return;
      }
      setAuth(base, key);
      onSuccess();
    } catch {
      setErr("Não foi possível conectar à URL informada");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4"
      style={{
        background: "linear-gradient(135deg, hsl(152 60% 96%) 0%, hsl(220 20% 98%) 50%, hsl(0 0% 100%) 100%)",
      }}
    >
      <div className="w-full max-w-sm animate-slide-up">
        <div className="rounded-2xl border bg-card p-8 space-y-6" style={{ boxShadow: "0 8px 32px rgb(0 0 0 / 0.06), 0 4px 12px rgb(0 0 0 / 0.04)" }}>
          {/* Logo & branding */}
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md">
              <PhoneCall className="h-7 w-7" />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">RockCall</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Acesse com a URL do servidor e sua API key
              </p>
            </div>
          </div>

          {/* Form */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">
                URL do Servidor
              </Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://call.seudominio.com"
                className={err && !key ? "border-destructive focus-visible:ring-destructive" : ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">
                API Key
              </Label>
              <Input
                type="password"
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                  if (err) setErr("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                placeholder="sua chave de acesso"
                className={err ? "border-destructive focus-visible:ring-destructive" : ""}
              />
            </div>

            {err && (
              <p className="text-sm text-destructive font-medium animate-fade-in-fast">
                {err}
              </p>
            )}

            <Button className="w-full h-10 text-sm font-semibold" disabled={busy || !key.trim()} onClick={submit}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Entrar
            </Button>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground/60 mt-4">
          WhatsApp voice calls with AI-powered agents
        </p>
      </div>
    </div>
  );
};
