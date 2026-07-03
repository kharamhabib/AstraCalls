export type HistoryRow = {
  callId: string;
  peer: string;
  phone: string;
  name?: string;
  direction: string;
  startedAt: number;
  endedAt: number | null;
  endReason: string | null;
  summary?: string;
  ticketOpened?: boolean;
  ticketReason?: string;
};
