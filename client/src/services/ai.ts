import { apiGet, apiPost, apiDelete } from "@/lib/api";
import type { AIConfig } from "@/types/ai";

export const getAIConfig = (sid: string) =>
  apiGet<{ aiConfig: AIConfig; enabled: boolean }>(`/api/sessions/${sid}/ai-config`);

export const setAIConfig = (sid: string, config: AIConfig) =>
  apiPost<{ aiConfig: AIConfig }>(`/api/sessions/${sid}/ai-config`, config);

export const deleteAIConfig = (sid: string) =>
  apiDelete(`/api/sessions/${sid}/ai-config`);

export const getNPSSummary = (sid: string) =>
  apiGet<{ summary: import("@/types/ai").NPSSummary }>(`/api/sessions/${sid}/nps/summary`);

export const getNPSRatings = (sid: string) =>
  apiGet<{ ratings: import("@/types/ai").CallRating[] }>(`/api/sessions/${sid}/nps`);

