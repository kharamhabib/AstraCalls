import { apiGet, apiPost, apiDelete } from "@/lib/api";

export const startCall = (sid: string, phone: string, record: boolean, ai?: boolean, prompt?: string, greeting?: string) =>
  apiPost<{ call: { callId: string } }>(`/api/sessions/${sid}/calls`, {
    phone,
    duration_ms: 300_000,
    record,
    ai,
    prompt,
    greeting,
  });

export const acceptCall = (sid: string, callId: string, ai?: boolean) =>
  apiPost<{ call: { callId: string } }>(`/api/sessions/${sid}/calls/${callId}/accept`, { ai });

export const rejectCall = (sid: string, callId: string) =>
  apiPost<void>(`/api/sessions/${sid}/calls/${callId}/reject`, {});

export const endCall = (sid: string, callId: string) =>
  apiDelete(`/api/sessions/${sid}/calls/${callId}`);

export const getContactInfo = (sid: string, jid: string) =>
  apiGet<{ jid: string; phone: string; name: string; pictureUrl: string }>(
    `/api/sessions/${sid}/contacts/${encodeURIComponent(jid)}`
  );
