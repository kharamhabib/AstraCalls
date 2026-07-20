import { useState, useRef, useEffect } from "react";
import { Phone, Delete, Mic, MicOff, PhoneOff, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { startCall, endCall } from "@/services/calls";
import { useCalls } from "@/stores/calls";
import { useAIAgents } from "@/stores/ai";
import { useContactInfo } from "@/hooks/useContactInfo";
import { formatPhoneNumber } from "@/utils/format";
import { cn } from "@/lib/utils";

export const ddiOptions = [
  { code: "55", flag: "🇧🇷", label: "+55 BR" },
  { code: "1", flag: "🇺🇸", label: "+1 US/CA" },
  { code: "351", flag: "🇵🇹", label: "+351 PT" },
  { code: "54", flag: "🇦🇷", label: "+54 AR" },
  { code: "52", flag: "🇲🇽", label: "+52 MX" },
  { code: "34", flag: "🇪🇸", label: "+34 ES" },
  { code: "44", flag: "🇬🇧", label: "+44 UK" },
];

export const formatPhoneInput = (val: string, ddi = "55"): string => {
  let digits = val.replace(/\D/g, "");
  if (!digits) return "";

  // Se o usuário colou com DDI +55 (12 ou 13 dígitos), removemos o 55 inicial para formatar (DDD) NÚMERO
  if (ddi === "55" && digits.startsWith("55") && digits.length >= 12) {
    digits = digits.slice(2);
  }

  if (digits.length <= 2) {
    return `(${digits}`;
  }
  if (digits.length <= 6) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  }
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
};

export const normalizePhoneWithDDI = (ddi: string, phoneInput: string): string => {
  const digitsOnly = phoneInput.replace(/\D/g, "");
  if (!digitsOnly) return "";
  const ddiDigits = ddi.replace(/\D/g, "");
  if (ddiDigits && digitsOnly.startsWith(ddiDigits) && digitsOnly.length > ddiDigits.length + 8) {
    return digitsOnly;
  }
  return `${ddiDigits}${digitsOnly}`;
};

interface WebphoneProps {
  sid: string;
  useAI?: boolean;
  prompt?: string;
}

export const Webphone = ({ sid, useAI = true, prompt = "" }: WebphoneProps) => {
  const [ddi, setDdi] = useState("55");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [muted, setMuted] = useState(false);

  const calls = useCalls((s) => s.calls);
  const activeCall = calls.find((c) => c.sessionId === sid && c.status !== "ended");
  const isAgentActive = activeCall ? useAIAgents.getState().activeAgentCalls.has(activeCall.callId) : false;
  const transcript = activeCall ? useAIAgents.getState().transcripts[activeCall.callId] || [] : [];
  const activeCustomPrompt = activeCall ? useAIAgents.getState().customPrompts[activeCall.callId] : null;
  const transcriptRef = useRef<HTMLDivElement>(null);

  const { data: contact } = useContactInfo(sid, activeCall?.peer);

  const displayPhone = formatPhoneNumber(contact?.phone || activeCall?.peer);
  const displayName = contact?.name && contact.name !== contact.phone ? contact.name : displayPhone;
  const hasContactName = Boolean(contact?.name && contact.name !== contact.phone);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  const handleKeyPress = (digit: string) => {
    const raw = phone.replace(/\D/g, "");
    if (raw.length < 11) {
      setPhone(formatPhoneInput(raw + digit, ddi));
    }
  };

  const handleBackspace = () => {
    const raw = phone.replace(/\D/g, "");
    setPhone(formatPhoneInput(raw.slice(0, -1), ddi));
  };

  const handleCall = async () => {
    if (!phone.trim()) {
      toast.error("Informe o número de telefone.");
      return;
    }

    const fullPhone = normalizePhoneWithDDI(ddi, phone);
    if (!fullPhone || fullPhone.length < 8) {
      toast.error("Número de telefone inválido.");
      return;
    }

    setLoading(true);
    try {
      await startCall(
        sid,
        fullPhone,
        true,
        useAI,
        prompt.trim() || undefined
      );
      toast.success(`Iniciando chamada para +${fullPhone}...`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleHangup = async () => {
    if (!activeCall) return;
    try {
      await endCall(sid, activeCall.callId);
      toast.info("Chamada finalizada.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  // Teclado numérico limpo (0-9)
  const numericKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <div className="rounded-3xl border bg-card p-6 shadow-xl space-y-5 animate-fade-in transition-all">
      {/* Phone Header */}
      <div className="flex items-center justify-between border-b pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary font-bold">
            <Phone className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-base font-extrabold tracking-tight text-foreground">Discador Webphone</h3>
            <p className="text-[11px] text-muted-foreground font-medium">Ligue diretamente para qualquer contato</p>
          </div>
        </div>
      </div>

      {/* Active Call Card Overlay */}
      {activeCall ? (
        <div className="rounded-2xl border bg-emerald-500/10 p-5 text-center space-y-4 animate-scale-in">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg animate-pulse">
            <Phone className="h-7 w-7" />
          </div>
          <div>
            <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">Chamada Em Andamento</p>
            <h4 className="text-lg font-extrabold truncate px-2 text-foreground" title={displayName}>
              {displayName}
            </h4>
            {hasContactName && (
              <p className="text-xs font-medium text-muted-foreground font-mono truncate">{displayPhone}</p>
            )}
            <div className="flex items-center justify-center gap-2 mt-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
              <span className="text-xs text-muted-foreground font-medium">
                {isAgentActive ? "Atendimento por IA (Gemini Live)" : "Atendimento Manual"}
              </span>
            </div>
            {activeCustomPrompt && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 mt-2 truncate font-medium">
                💡 {activeCustomPrompt}
              </p>
            )}
          </div>

          {/* Transcript Snippet */}
          {transcript.length > 0 && (
            <div ref={transcriptRef} className="rounded-xl border bg-background/80 p-3 text-left max-h-36 overflow-y-auto text-xs space-y-1.5 custom-scrollbar">
              {transcript.slice(-3).map((t, idx) => (
                <div key={idx} className="flex items-start gap-1.5">
                  <span className={cn("font-bold shrink-0", t.speaker === "ai" ? "text-primary" : "text-emerald-500")}>
                    {t.speaker === "ai" ? "IA:" : "Cliente:"}
                  </span>
                  <span className="text-muted-foreground">{t.text}</span>
                </div>
              ))}
            </div>
          )}

          {/* Active Controls */}
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setMuted(!muted)}
              className={cn("h-11 w-11 rounded-full transition-all", muted && "bg-amber-500/15 text-amber-500 border-amber-500/30")}
              title={muted ? "Desmutar" : "Mutar Mic"}
            >
              {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </Button>

            <Button
              variant="destructive"
              size="icon"
              onClick={handleHangup}
              className="h-12 w-12 rounded-full shadow-md hover:scale-105 transition-all"
              title="Desligar"
            >
              <PhoneOff className="h-6 w-6" />
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Display Field com Seletor de DDI */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-muted-foreground flex items-center gap-1">
              <Globe className="h-3 w-3 text-primary" />
              <span>Número de Telefone:</span>
            </label>

            <div className="flex items-center rounded-2xl border bg-muted/30 focus-within:bg-background focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all p-1.5 gap-2">
              {/* Seletor de DDI */}
              <div className="relative flex items-center shrink-0 border-r pr-2 border-border/60">
                <select
                  value={ddi}
                  onChange={(e) => {
                    const newDdi = e.target.value;
                    setDdi(newDdi);
                    if (phone) setPhone(formatPhoneInput(phone, newDdi));
                  }}
                  className="bg-transparent font-mono text-xs font-bold text-foreground cursor-pointer focus:outline-none pr-1 pl-1"
                >
                  {ddiOptions.map((opt) => (
                    <option key={opt.code} value={opt.code} className="bg-card text-foreground font-mono">
                      {opt.flag} +{opt.code}
                    </option>
                  ))}
                </select>
              </div>

              {/* Input Numérico com Formatação de Telefone */}
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(formatPhoneInput(e.target.value, ddi))}
                placeholder="Ex: (11) 99YYY-XXXX"
                className="w-full bg-transparent text-lg font-bold tracking-wider text-foreground focus:outline-none placeholder:text-muted-foreground/40 placeholder:font-normal placeholder:text-xs font-mono"
              />

              {phone && (
                <button
                  type="button"
                  onClick={handleBackspace}
                  className="text-muted-foreground hover:text-foreground transition-colors p-1 shrink-0"
                  title="Apagar dígito"
                >
                  <Delete className="h-5 w-5" />
                </button>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground font-medium pl-1">
              O DDI <span className="font-bold text-primary font-mono">+{ddi}</span> será incluído automaticamente ao ligar.
            </p>
          </div>

          {/* Teclado Numérico Limpo 0-9 */}
          <div className="grid grid-cols-3 gap-2.5 pt-1">
            {numericKeys.map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => handleKeyPress(num)}
                className="flex h-12 items-center justify-center rounded-2xl border bg-card hover:bg-muted/60 active:scale-95 transition-all text-lg font-extrabold text-foreground shadow-2xs"
              >
                {num}
              </button>
            ))}

            {/* Linha inferior: Limpar, 0 e Backspace */}
            <button
              type="button"
              onClick={() => setPhone("")}
              disabled={!phone}
              className="flex h-12 items-center justify-center rounded-2xl border bg-card hover:bg-muted/60 active:scale-95 transition-all text-xs font-bold text-muted-foreground disabled:opacity-40"
              title="Limpar tudo"
            >
              C
            </button>

            <button
              type="button"
              onClick={() => handleKeyPress("0")}
              className="flex h-12 items-center justify-center rounded-2xl border bg-card hover:bg-muted/60 active:scale-95 transition-all text-lg font-extrabold text-foreground shadow-2xs"
            >
              0
            </button>

            <button
              type="button"
              onClick={handleBackspace}
              disabled={!phone}
              className="flex h-12 items-center justify-center rounded-2xl border bg-card hover:bg-muted/60 active:scale-95 transition-all text-muted-foreground disabled:opacity-40"
              title="Apagar último dígito"
            >
              <Delete className="h-5 w-5" />
            </button>
          </div>

          {/* Botão de Ligar */}
          <Button
            onClick={handleCall}
            disabled={loading || !phone}
            className="w-full h-12 rounded-2xl gap-2 text-base font-bold shadow-md bg-emerald-500 hover:bg-emerald-600 text-white transition-all active:scale-[0.98]"
          >
            <Phone className="h-5 w-5" />
            <span>{useAI ? "Ligar com IA" : "Ligar Manual"}</span>
          </Button>
        </>
      )}
    </div>
  );
};
