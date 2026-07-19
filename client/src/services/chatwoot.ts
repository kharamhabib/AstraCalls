import { apiGet, apiPost, apiDelete } from "@/lib/api";

export type ChatwootConfig = {
  url: string;
  account_id: number;
  account_token?: string;
  inbox_id: number;
  inbox_identifier: string;
  webhook_secret?: string; // token que autentica o POST .../chatwoot/webhook
};

export const getChatwoot = (sid: string) =>
  apiGet<{ enabled: boolean; chatwoot: ChatwootConfig }>(`/api/sessions/${sid}/chatwoot`);

export const setChatwoot = (sid: string, cfg: ChatwootConfig) =>
  apiPost(`/api/sessions/${sid}/chatwoot`, cfg);

export const deleteChatwoot = (sid: string) => apiDelete(`/api/sessions/${sid}/chatwoot`);
