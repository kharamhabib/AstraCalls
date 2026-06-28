import { apiGet, apiPost, apiDelete } from "@/lib/api";
import type { AIConfig } from "@/types/ai";

export const getAIConfig = (sid: string) =>
  apiGet<{ aiConfig: AIConfig; enabled: boolean }>(`/api/sessions/${sid}/ai-config`);

export const setAIConfig = (sid: string, config: AIConfig) =>
  apiPost<{ aiConfig: AIConfig }>(`/api/sessions/${sid}/ai-config`, config);

export const deleteAIConfig = (sid: string) =>
  apiDelete(`/api/sessions/${sid}/ai-config`);
