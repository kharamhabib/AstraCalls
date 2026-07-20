import { useState } from "react";
import { Loader2, PhoneCall, KeyRound, Mail, Building } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setAuth } from "@/lib/auth";

export const LoginScreen = ({ onSuccess }: { onSuccess: () => void }) => {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [projectName, setProjectName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Sempre usa o servidor atual — sem necessidade de configurar URL
  const base = window.location.origin;

  const submit = async () => {
    setBusy(true);
    setErr("");
    setSuccessMsg("");

    try {
      if (isRegister) {
        const r = await fetch(`${base}/api/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, name: projectName }),
        });
        const data = await r.json();
        if (!r.ok) {
          setErr(data.error || `Erro ${r.status}`);
          return;
        }
        setSuccessMsg("Conta criada! Entrando...");
      }

      const loginRes = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const loginData = await loginRes.json();
      if (!loginRes.ok) {
        setErr(loginData.error || `Erro ${loginRes.status}`);
        return;
      }

      setAuth(base, loginData.token, loginData.user);
      onSuccess();
    } catch {
      setErr("Não foi possível conectar ao servidor.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{
        background: "linear-gradient(135deg, hsl(222.2 47.4% 11.2%) 0%, hsl(222.2 47.4% 6%) 100%)",
      }}
    >
      <div className="w-full max-w-sm animate-slide-up">
        <div
          className="rounded-2xl border border-slate-800 bg-slate-950/80 p-8 space-y-6 text-slate-100 backdrop-blur-md"
          style={{ boxShadow: "0 8px 32px rgb(0 0 0 / 0.3), 0 4px 12px rgb(0 0 0 / 0.2)" }}
        >
          {/* Logo & branding */}
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/20">
              <PhoneCall className="h-7 w-7" />
            </span>
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
                Kallia
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                {isRegister
                  ? "Crie sua conta e inicie seu projeto"
                  : "Acesse com seu e-mail e senha"}
              </p>
            </div>
          </div>

          {/* Form */}
          <div className="space-y-4">
            {isRegister && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                  <Building className="h-3.5 w-3.5" /> Nome do Projeto / Empresa
                </Label>
                <Input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="Ex: Minha Empresa CallCenter"
                  className="bg-slate-900/60 border-slate-800 focus-visible:ring-indigo-500 text-slate-100 placeholder:text-slate-600"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" /> E-mail
              </Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                placeholder="nome@exemplo.com"
                className="bg-slate-900/60 border-slate-800 focus-visible:ring-indigo-500 text-slate-100 placeholder:text-slate-600"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5" /> Senha
              </Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (err) setErr("");
                }}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                placeholder="••••••••"
                className="bg-slate-900/60 border-slate-800 focus-visible:ring-indigo-500 text-slate-100 placeholder:text-slate-600"
              />
            </div>

            {err && (
              <p className="text-sm text-red-400 font-medium">{err}</p>
            )}
            {successMsg && (
              <p className="text-sm text-green-400 font-medium">{successMsg}</p>
            )}

            <Button
              className="w-full h-10 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white"
              disabled={busy || !email.trim() || !password.trim() || (isRegister && !projectName.trim())}
              onClick={submit}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {isRegister ? "Cadastrar Projeto" : "Entrar"}
            </Button>
          </div>

          <div className="text-center">
            <button
              onClick={() => { setIsRegister(!isRegister); setErr(""); setSuccessMsg(""); }}
              className="text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              {isRegister
                ? "Já possui uma conta? Faça login"
                : "Não tem uma conta? Cadastre aqui"}
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-slate-500 mt-4">
          WhatsApp voice calls with AI-powered agents
        </p>
      </div>
    </div>
  );
};
