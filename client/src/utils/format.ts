import type { CallStatus } from "@/types/call";

export const formatCallDuration = (startedAt: number, status: CallStatus): string => {
  if (status !== "connected") return status;
  const s = Math.floor((Date.now() - startedAt) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export const formatPhoneNumber = (value?: string | null): string => {
  if (!value) return "";
  const user = value.split("@")[0];
  const cleaned = user.replace(/\D/g, "");
  if (!cleaned) return value;

  // Se o número for muito longo (>13 dígitos), é provavelmente um LID não resolvido.
  // Evitamos formatar como DDI/DDD padrão e apenas exibimos limpo.
  if (cleaned.length > 13) {
    return value.includes("@lid") ? user : `+${cleaned}`;
  }

  if (cleaned.length <= 2) return `+${cleaned}`;
  if (cleaned.length <= 4) return `+${cleaned.slice(0, 2)} (${cleaned.slice(2)}`;
  if (cleaned.length <= 8) return `+${cleaned.slice(0, 2)} (${cleaned.slice(2, 4)}) ${cleaned.slice(4)}`;
  if (cleaned.length <= 12) return `+${cleaned.slice(0, 2)} (${cleaned.slice(2, 4)}) ${cleaned.slice(4, 8)}-${cleaned.slice(8)}`;
  return `+${cleaned.slice(0, 2)} (${cleaned.slice(2, 4)}) ${cleaned.slice(4, 9)}-${cleaned.slice(9, 13)}`;
};

export const formatDuration = (startedAt: number, endedAt: number | null): string => {
  if (!endedAt) return "Em andamento";
  const secs = Math.floor((endedAt - startedAt) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remainSecs}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
};

export const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  if (parts[0]) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return "?";
};

export const isCallMissedOrRejected = (startedAt: number, endedAt: number | null, endReason?: string | null): boolean => {
  if (!endedAt) return true;
  const duration = endedAt - startedAt;
  if (duration < 3000) return true;
  if (endReason === "rejected" || endReason === "no_answer" || endReason === "timeout" || endReason === "canceled") return true;
  return false;
};

export const isCallAnswered = (startedAt: number, endedAt: number | null, endReason?: string | null): boolean => {
  return !isCallMissedOrRejected(startedAt, endedAt, endReason);
};
