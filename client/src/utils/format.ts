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
  if (endReason === "accepted_elsewhere") return true;
  if (
    endReason === "rejected" ||
    endReason === "declined" ||
    endReason === "busy" ||
    endReason === "do_not_disturb" ||
    endReason === "no_answer" ||
    endReason === "timeout" ||
    endReason === "canceled" ||
    endReason === "cancelled" ||
    endReason === "failed" ||
    endReason === "unknown"
  ) return true;
  const duration = endedAt - startedAt;
  if (duration < 3000) return true;
  return false;
};

export const isCallAnswered = (startedAt: number, endedAt: number | null, endReason?: string | null): boolean => {
  return !isCallMissedOrRejected(startedAt, endedAt, endReason);
};

export interface CallStatusDetails {
  statusType: "accepted_elsewhere" | "rejected" | "missed" | "completed";
  badgeText: string;
  badgeClass: string;
  cardBorderClass: string;
  descriptionText: string;
  showMedia: boolean;
}

export const getCallStatusDetails = (
  startedAt: number,
  endedAt: number | null,
  endReason?: string | null,
  direction?: string | null
): CallStatusDetails => {
  const isInbound = direction === "inbound";
  const duration = endedAt ? endedAt - startedAt : 0;
  const isAcceptedElsewhere = endReason === "accepted_elsewhere";
  const isRejected =
    endReason === "rejected" ||
    endReason === "declined" ||
    endReason === "busy" ||
    endReason === "do_not_disturb";
  const isMissed =
    !endedAt ||
    duration < 3000 ||
    endReason === "no_answer" ||
    endReason === "timeout" ||
    endReason === "canceled" ||
    endReason === "cancelled" ||
    endReason === "failed" ||
    endReason === "unknown";

  if (isAcceptedElsewhere) {
    return {
      statusType: "accepted_elsewhere",
      badgeText: isInbound ? "Recebida (Outro aparelho)" : "Efetuada (Outro aparelho)",
      badgeClass: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
      cardBorderClass: "border-blue-500/20 bg-blue-500/[0.02] hover:border-blue-500/30",
      descriptionText: isInbound
        ? "Chamada recebida — Atendida em outro dispositivo"
        : "Chamada efetuada — Atendida em outro dispositivo",
      showMedia: false,
    };
  }

  if (isRejected) {
    return {
      statusType: "rejected",
      badgeText: isInbound ? "Recebida (Recusada)" : "Efetuada (Recusada)",
      badgeClass: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
      cardBorderClass: "border-red-500/20 bg-red-500/[0.02] hover:border-red-500/30",
      descriptionText: isInbound
        ? "Chamada recebida — Você recusou a ligação"
        : "Chamada efetuada — O contato recusou a ligação",
      showMedia: false,
    };
  }

  if (isMissed) {
    return {
      statusType: "missed",
      badgeText: isInbound ? "Recebida (Não atendida)" : "Efetuada (Não atendida)",
      badgeClass: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
      cardBorderClass: "border-amber-500/20 bg-amber-500/[0.02] hover:border-amber-500/30",
      descriptionText: isInbound
        ? "Chamada recebida não atendida (Perdida)"
        : "Chamada efetuada não atendida (Sem resposta)",
      showMedia: false,
    };
  }

  return {
    statusType: "completed",
    badgeText: isInbound ? "Recebida (Atendida)" : "Efetuada (Atendida)",
    badgeClass: isInbound
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
      : "bg-primary/10 text-primary border-primary/20",
    cardBorderClass: "border-primary/10 bg-card hover:shadow-xs",
    descriptionText: isInbound
      ? "Chamada recebida e atendida"
      : "Chamada efetuada e atendida",
    showMedia: true,
  };
};
