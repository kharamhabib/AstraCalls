import { getApiBase, getToken, clearAuth } from "./auth";
import type { CallStatus } from "@/types/call";
import type { SessionInfo, SessionState } from "@/types/session";

type CallListRow = {
  sessionId: string;
  callId: string;
  owner: string | null;
  direction: "outbound" | "inbound";
  peer: string;
  startedAt: number;
  status: CallStatus;
  endedAt?: number;
  endReason?: string;
};

export type BrokerEvent =
  | { type: "session-list"; sessions: SessionInfo[] }
  | { type: "session-qr"; sessionId: string; qr: string }
  | { type: "auth-state"; sessionId: string; paired: boolean; state: SessionState; qr?: string }
  | { type: "call-list"; calls: CallListRow[] }
  | { type: "call-status"; sessionId: string; id: string; owner: string | null; status: CallStatus; peer: string; startedAt: number }
  | { type: "call-ended"; sessionId: string; id: string; owner: string | null; reason: string; endedAt: number }
  | { type: "incoming"; sessionId: string; id: string; peer: string; offeredAt: number }
  | { type: "incoming-claimed"; sessionId: string; id: string; owner: string }
  | { type: "ai-agent-active"; sessionId: string; callId: string; server: boolean }
  | { type: "ai-transcript"; sessionId: string; callId: string; speaker: string; text: string }
  | { type: "ai-interrupted"; sessionId: string; callId: string };

type Listener = (ev: BrokerEvent) => void;

export type StreamStatus = "connected" | "reconnecting" | "disconnected";
type StatusListener = (status: StreamStatus) => void;

// fetchEventTicket troca a API key (header) por um ticket de uso único (30s)
// para autenticar o EventSource sem expor a key na URL — que vazaria em logs
// de proxy, histórico do navegador e ferramentas de monitoramento.
export const fetchEventTicket = async (): Promise<string> => {
  const r = await fetch(`${getApiBase()}/api/events/ticket`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${getToken()}`, "Content-Type": "application/json" },
  });
  if (r.status === 401) {
    clearAuth();
    location.reload();
    throw new Error("unauthorized");
  }
  if (!r.ok) throw new Error(`ticket ${r.status}`);
  const data = (await r.json()) as { ticket: string };
  return data.ticket;
};

// Como o ticket é de uso único, o reconnect automático do EventSource (que
// repete a mesma URL) não funciona — fazemos reconexão manual: cada tentativa
// emite um ticket novo, com backoff exponencial até 30s.
class EventStream {
  #es: EventSource | null = null;
  #listeners = new Set<Listener>();
  #statusListeners = new Set<StatusListener>();
  #status: StreamStatus = "disconnected";
  #clientId = "";
  #wantConnected = false;
  #retry = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;

  get status(): StreamStatus {
    return this.#status;
  }

  #setStatus(s: StreamStatus): void {
    if (this.#status === s) return;
    this.#status = s;
    for (const l of this.#statusListeners) l(s);
  }

  connect(clientId: string): void {
    if (this.#wantConnected) return;
    this.#clientId = clientId;
    this.#wantConnected = true;
    void this.#open();
  }

  async #open(): Promise<void> {
    if (!this.#wantConnected) return;
    this.#setStatus("reconnecting");
    let ticket: string;
    try {
      ticket = await fetchEventTicket(); // em 401 limpa auth e recarrega a tela
    } catch {
      this.#scheduleReconnect();
      return;
    }
    if (!this.#wantConnected) return;

    const url = `${getApiBase()}/api/events?clientId=${encodeURIComponent(this.#clientId)}&ticket=${encodeURIComponent(ticket)}`;
    const es = new EventSource(url);
    this.#es = es;
    es.onopen = () => {
      this.#retry = 0;
      this.#setStatus("connected");
    };
    es.onmessage = (ev) => {
      try {
        const parsed: BrokerEvent = JSON.parse(ev.data);
        for (const l of this.#listeners) l(parsed);
      } catch {}
    };
    es.onerror = () => {
      es.close();
      if (this.#es === es) this.#es = null;
      this.#scheduleReconnect();
    };
  }

  #scheduleReconnect(): void {
    if (!this.#wantConnected) return;
    this.#setStatus("reconnecting");
    const delay = Math.min(30000, 1000 * 2 ** this.#retry);
    this.#retry += 1;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.#open(), delay);
  }

  on(l: Listener): () => void {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  }

  onStatus(l: StatusListener): () => void {
    this.#statusListeners.add(l);
    l(this.#status);
    return () => this.#statusListeners.delete(l);
  }

  close(): void {
    this.#wantConnected = false;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#es?.close();
    this.#es = null;
    this.#setStatus("disconnected");
  }
}

export const eventStream = new EventStream();
