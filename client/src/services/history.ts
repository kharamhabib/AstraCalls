import { apiGet } from "@/lib/api";
import type { HistoryRow } from "@/types/history";

export interface TranscriptLine {
  speaker: string;
  text: string;
}

export const fetchHistory = (sid: string) =>
  apiGet<{ rows: HistoryRow[] }>(`/api/sessions/${sid}/history?limit=50`).then((r) => r.rows ?? []);

export const fetchTranscript = (sid: string, callId: string) =>
  apiGet<{ transcript: TranscriptLine[] }>(`/api/sessions/${sid}/history/${callId}/transcript`).then((r) => r.transcript ?? []);

