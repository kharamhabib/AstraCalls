import { useQuery } from "@tanstack/react-query";
import { fetchHistory, fetchTranscript } from "@/services/history";

export const useHistory = (sid: string | null, enabled: boolean) =>
  useQuery({
    queryKey: ["history", sid],
    queryFn: () => fetchHistory(sid as string),
    enabled: enabled && !!sid,
  });

export const useTranscript = (sid: string | null, callId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: ["transcript", sid, callId],
    queryFn: () => fetchTranscript(sid as string, callId as string),
    enabled: enabled && !!sid && !!callId,
  });

