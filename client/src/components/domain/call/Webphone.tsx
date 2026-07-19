import { useState, useRef, useEffect } from "react";
import { Phone, Delete, Bot, Mic, MicOff, PhoneOff, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { startCall, endCall } from "@/services/calls";
import { useCalls } from "@/stores/calls";
import { useAIAgents } from "@/stores/ai";
import { useContactInfo } from "@/hooks/useContactInfo";
import { formatPhoneNumber } from "@/utils/format";
import { cn } from "@/lib/utils";

const dialpadKeys = [
  { key: "1", sub: "" },
  { key: "2", sub: "ABC" },
  { key: "3", sub: "DEF" },
  { key: "4", sub: "GHI" },
  { key: "5", sub: "JKL" },
  { key: "6", sub: "MNO" },
  { key: "7", sub: "PQRS" },
  { key: "8", sub: "TUV" },
  { key: "9", sub: "WXYZ" },
  { key: "*", sub: "" },
  { key: "0", sub: "+" },
  { key: "#", sub: "" },
];

export const Webphone = ({ sid }: { sid: string }) => {
  const [phone, setPhone] = useState("");
  const [useAI, setUseAI] = useState(true);
  const [loading, setLoading] = useState(false);
  const [muted, setMuted] = useState(false);

  const calls = useCalls((s) => s.calls);
  const activeCall = calls.find((c) => c.sessionId === sid && c.status !== "ended");
  const isAgentActive = activeCall ? useAIAgents.getState().activeAgentCalls.has(activeCall.callId) : false;
  const transcript = activeCall ? useAIAgents.getState().transcripts[activeCall.callId] || [] : [];
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
    if (phone.length < 20) {
      setPhone((prev) => prev + digit);
    }
  };

  const handleBackspace = () => {
    setPhone((prev) => prev.slice(0, -1));
  };

  const handleCall = async () => {
    if (!phone.trim()) {
      toast.error("Informe um número de telefone.");
      return;
    }
    setLoading(true);
    try {
      await startCall(sid, phone, true, useAI);
      toast.success("Iniciando chamada...");
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

  return (
    <div className="mx-auto max-w-sm rounded-3xl border bg-card p-6 shadow-xl space-y-5 animate-fade-in">
      {/* Phone Header / Status Bar */}
      <div className="text-center space-y-1">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
          <Bot className="h-3.5 w-3.5" />
          <span>Softphone Kallia</span>
        </div>
        <h3 className="text-lg font-extrabold tracking-tight">Discador Webphone</h3>
      </div>

      {/* Active Call Card Overlay */}
      {activeCall ? (
        <div className="rounded-2xl border bg-emerald-500/10 p-5 text-center space-y-4 animate-scale-in">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg animate-pulse">
            <Phone className="h-7 w-7" />
          </div>
          <div>
            <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Chamada Em Andamento</p>
            <h4 className="text-lg font-bold truncate px-2" title={displayName}>
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
              className={cn("h-11 w-11 rounded-full", muted && "bg-amber-500/15 text-amber-500 border-amber-500/30")}
              title={muted ? "Desmutar" : "Mutar"}
            >
              {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </Button>

            <Button
              variant="destructive"
              size="icon"
              onClick={handleHangup}
              className="h-12 w-12 rounded-full shadow-md"
              title="Desligar"
            >
              <PhoneOff className="h-6 w-6" />
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Display Field */}
          <div className="relative flex items-center justify-between rounded-2xl border bg-muted/40 px-4 py-3">
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Digite o número..."
              className="w-full bg-transparent text-xl font-bold tracking-wider text-center focus:outline-none placeholder:text-muted-foreground/40 placeholder:font-normal placeholder:text-sm"
            />
            {phone && (
              <button
                onClick={handleBackspace}
                className="text-muted-foreground hover:text-foreground transition-colors p-1"
                title="Apagar digitado"
              >
                <Delete className="h-5 w-5" />
              </button>
            )}
          </div>

          {/* AI Mode Selector Pill */}
          <div className="flex items-center justify-between rounded-xl border bg-muted/30 p-2 text-xs">
            <span className="font-semibold text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              <span>Modo Atendimento IA</span>
            </span>
            <button
              type="button"
              onClick={() => setUseAI(!useAI)}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out",
                useAI ? "bg-primary" : "bg-muted-foreground/30",
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow-lg ring-0 transition duration-200 ease-in-out",
                  useAI ? "translate-x-4" : "translate-x-0",
                )}
              />
            </button>
          </div>

          {/* Dialpad Keys (3x4 Grid) */}
          <div className="grid grid-cols-3 gap-3">
            {dialpadKeys.map((item) => (
              <button
                key={item.key}
                onClick={() => handleKeyPress(item.key)}
                className="flex h-14 flex-col items-center justify-center rounded-2xl border bg-card hover:bg-muted/60 active:scale-95 transition-all shadow-xs"
              >
                <span className="text-xl font-bold">{item.key}</span>
                {item.sub && <span className="text-[9px] font-semibold text-muted-foreground/60 tracking-wider">{item.sub}</span>}
              </button>
            ))}
          </div>

          {/* Call Action Button */}
          <Button
            onClick={handleCall}
            disabled={loading || !phone}
            className="w-full h-12 rounded-2xl gap-2 text-base font-bold shadow-md bg-emerald-500 hover:bg-emerald-600 text-white"
          >
            <Phone className="h-5 w-5" />
            <span>{useAI ? "Ligar com IA" : "Ligar Manual"}</span>
          </Button>
        </>
      )}
    </div>
  );
};
