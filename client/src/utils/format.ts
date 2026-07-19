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
