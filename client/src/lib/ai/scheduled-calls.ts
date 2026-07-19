import type { ScheduledCall } from "@/types/ai";

// parseScheduledCalls centraliza o parse do campo scheduledCalls (JSON string
// na AIConfig) — antes era JSON.parse solto em vários lugares com try/catch
// silencioso. Vive num módulo leve para não puxar o agente de IA (~40KB) ao
// bundle principal quando só o parse é necessário.
export const parseScheduledCalls = (raw: string | undefined | null): ScheduledCall[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ScheduledCall[]) : [];
  } catch {
    return [];
  }
};
