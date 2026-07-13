import { create } from "zustand";
import type { GeminiLiveAgent } from "@/lib/gemini-live";
import type { AIConfig } from "@/types/ai";

export type TranscriptLine = {
  speaker: "client" | "ai";
  text: string;
  timestamp: Date;
};

type State = {
  activeAgentCalls: Set<string>;
  activeAgents: Map<string, GeminiLiveAgent>;
  transcripts: Record<string, TranscriptLine[]>;
  scheduledCallsInProgress: Set<string>; // callIds de chamadas agendadas feitas pela IA
  activeSessionConfig: AIConfig | null; // Config da sessão de IA atual
  customPrompts: Record<string, string>; // callId -> customPrompt de instrução adicional
  customGreetings: Record<string, string>; // callId -> primeira fala customizada
  setAgentActive: (callId: string, active: boolean) => void;
  setAgentInstance: (callId: string, agent: GeminiLiveAgent | null) => void;
  appendTranscription: (callId: string, speaker: "client" | "ai", text: string) => void;
  interruptTranscription: (callId: string) => void;
  clearTranscript: (callId: string) => void;
  addScheduledInProgress: (callId: string) => void;
  removeScheduledInProgress: (callId: string) => void;
  setActiveSessionConfig: (cfg: AIConfig | null) => void;
  setCustomPrompt: (callId: string, prompt: string) => void;
  getAndRemoveCustomPrompt: (callId: string) => string | undefined;
  setCustomGreeting: (callId: string, greeting: string) => void;
  getAndRemoveCustomGreeting: (callId: string) => string | undefined;
};

export const useAIAgents = create<State>((set, get) => ({
  activeAgentCalls: new Set(),
  activeAgents: new Map(),
  transcripts: {},
  scheduledCallsInProgress: new Set(),
  activeSessionConfig: null,
  customPrompts: {},
  customGreetings: {},
  setAgentActive: (callId, active) =>
    set((s) => {
      const next = new Set(s.activeAgentCalls);
      if (active) next.add(callId);
      else next.delete(callId);
      return { activeAgentCalls: next };
    }),
  setAgentInstance: (callId, agent) =>
    set((s) => {
      const next = new Map(s.activeAgents);
      if (agent) next.set(callId, agent);
      else next.delete(callId);
      return { activeAgents: next };
    }),
  addScheduledInProgress: (callId) =>
    set((s) => {
      const next = new Set(s.scheduledCallsInProgress);
      next.add(callId);
      return { scheduledCallsInProgress: next };
    }),
  removeScheduledInProgress: (callId) =>
    set((s) => {
      const next = new Set(s.scheduledCallsInProgress);
      next.delete(callId);
      return { scheduledCallsInProgress: next };
    }),
  appendTranscription: (callId, speaker, text) =>
    set((s) => {
      const lines = s.transcripts[callId] || [];
      const now = new Date();
      if (lines.length > 0) {
        const last = lines[lines.length - 1];
        const diff = now.getTime() - last.timestamp.getTime();
        // Se for o mesmo falante e o último trecho foi há menos de 4 segundos, concatena
        if (last.speaker === speaker && diff < 4000) {
          const nextLines = [...lines];
          // Trata espaçamento
          const separator = last.text.endsWith(" ") || text.startsWith(" ") ? "" : " ";
          nextLines[nextLines.length - 1] = {
            ...last,
            text: last.text + separator + text,
            timestamp: now,
          };
          return { transcripts: { ...s.transcripts, [callId]: nextLines } };
        } else {
          // O turno anterior terminou. Imprime a frase consolidada/concatenada no console
          console.log(`[GeminiLive] ${last.speaker === "ai" ? "📝 IA disse:" : "🎤 Cliente disse:"} ${last.text.trim()}`);
        }
      }
      // Caso contrário, cria uma nova linha de turno
      const nextLines = [...lines, { speaker, text, timestamp: now }];
      return { transcripts: { ...s.transcripts, [callId]: nextLines } };
    }),
  interruptTranscription: (callId) =>
    set((s) => {
      const lines = s.transcripts[callId] || [];
      if (lines.length === 0) return {};
      const nextLines = [...lines];
      const last = nextLines[nextLines.length - 1];
      if (last.speaker === "ai" && !last.text.endsWith("...")) {
        nextLines[nextLines.length - 1] = {
          ...last,
          text: last.text.trim() + "...",
          timestamp: new Date(0), // Força o próximo trecho a criar uma nova bolha
        };
      }
      return { transcripts: { ...s.transcripts, [callId]: nextLines } };
    }),
  clearTranscript: (callId) =>
    set((s) => {
      const next = { ...s.transcripts };
      delete next[callId];
      const nextAgents = new Map(s.activeAgents);
      const agent = nextAgents.get(callId);
      if (agent) {
        void agent.detach().catch(console.error);
        nextAgents.delete(callId);
      }
      return { transcripts: next, activeAgents: nextAgents };
    }),
  setActiveSessionConfig: (cfg) => set({ activeSessionConfig: cfg }),
  setCustomPrompt: (callId, prompt) =>
    set((s) => ({
      customPrompts: { ...s.customPrompts, [callId]: prompt }
    })),
  getAndRemoveCustomPrompt: (callId) => {
    const prompt = get().customPrompts[callId];
    if (prompt !== undefined) {
      set((s) => {
        const next = { ...s.customPrompts };
        delete next[callId];
        return { customPrompts: next };
      });
    }
    return prompt;
  },
  setCustomGreeting: (callId, greeting) =>
    set((s) => ({
      customGreetings: { ...s.customGreetings, [callId]: greeting }
    })),
  getAndRemoveCustomGreeting: (callId) => {
    const greeting = get().customGreetings[callId];
    if (greeting !== undefined) {
      set((s) => {
        const next = { ...s.customGreetings };
        delete next[callId];
        return { customGreetings: next };
      });
    }
    return greeting;
  },
}));
