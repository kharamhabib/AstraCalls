// Módulo de compatibilidade: a implementação foi modularizada em lib/ai/*.
// Mantido para não quebrar os imports existentes ("@/lib/gemini-live").
// NOTA: para não puxar o agente (~40KB) ao bundle principal, importe os
// módulos leves diretamente ("@/lib/ai/default-prompts", "@/lib/ai/scheduled-calls").
export { PCMPlayer, base64ToFloat32, uint8ToBase64 } from "./ai/pcm-utils";
export { GeminiLiveSession } from "./ai/gemini-session";
export type { ToolArgs, ToolResult, ToolCallHandler, GeminiSessionOptions } from "./ai/gemini-session";
export { GeminiLiveAgent } from "./ai/agent";
export { parseScheduledCalls } from "./ai/scheduled-calls";
export { DEFAULT_TOOL_PROMPTS, FETCH_CHATWOOT_HISTORY_PROMPT, TOOL_RULES_HEADER } from "./ai/default-prompts";
