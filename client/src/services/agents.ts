import { apiGet, apiPost, apiDelete, apiPut } from "@/lib/api";

export interface Agent {
  id: string;
  sessionId: string;
  name: string;
  description: string;
  // Derived from inbound/outbound booleans returned by backend
  role: "inbound" | "outbound" | "both";
  isActive: boolean; // true if inbound or outbound is set
  inbound: boolean;
  outbound: boolean;
  aiConfig: {
    systemInstruction?: string;
    voiceName?: string;
    languageCode?: string;
    temperature?: number;
    toolsEnabled?: boolean;
    predefinedTools?: string[];
    geminiApiKey?: string;
  };
  createdAt?: string;
}

/** What we send to the backend */
interface AgentPayload {
  name: string;
  description: string;
  aiConfig: string; // JSON-serialized AIConfig
  inbound: boolean;
  outbound: boolean;
}

export interface AgentUpsert {
  name: string;
  description: string;
  role: Agent["role"];
  isActive: boolean;
  aiConfig: Agent["aiConfig"];
}

/** Convert backend row (inbound/outbound) to the nicer Agent interface */
const mapAgent = (row: any): Agent => {
  const inbound = !!row.inbound;
  const outbound = !!row.outbound;
  const role: Agent["role"] = inbound && outbound ? "both" : inbound ? "inbound" : "outbound";
  let aiConfig = {};
  try { aiConfig = JSON.parse(row.aiConfig || "{}"); } catch {}
  return {
    id: row.id,
    sessionId: row.sessionId,
    name: row.name,
    description: row.description,
    role,
    isActive: inbound || outbound,
    inbound,
    outbound,
    aiConfig,
    createdAt: row.createdAt,
  };
};

/** Build the raw payload for the backend from our AgentUpsert shape */
const toPayload = (data: AgentUpsert): AgentPayload => ({
  name: data.name,
  description: data.description,
  aiConfig: JSON.stringify(data.aiConfig),
  inbound: data.role === "inbound" || data.role === "both",
  outbound: data.role === "outbound" || data.role === "both",
});

export const listAgents = async (sessionId: string): Promise<Agent[]> => {
  const r = await apiGet<{ agents: any[] }>(`/api/sessions/${sessionId}/agents`);
  return (r.agents ?? []).map(mapAgent);
};

export const createAgent = async (sessionId: string, data: AgentUpsert): Promise<Agent> => {
  const r = await apiPost<{ id: string }>(`/api/sessions/${sessionId}/agents`, toPayload(data));
  // Refetch to get the full row
  const agents = await listAgents(sessionId);
  return agents.find((a) => a.id === r.id) ?? ({ id: r.id, ...data, inbound: false, outbound: false, isActive: false } as any);
};

export const updateAgent = async (sessionId: string, agentId: string, data: Partial<AgentUpsert>): Promise<void> => {
  await apiPut<{ status: string }>(`/api/sessions/${sessionId}/agents/${agentId}`, {
    name: data.name ?? "",
    description: data.description ?? "",
    aiConfig: JSON.stringify(data.aiConfig ?? {}),
    inbound: data.role === "inbound" || data.role === "both",
    outbound: data.role === "outbound" || data.role === "both",
  });
};

export const deleteAgent = (sessionId: string, agentId: string) =>
  apiDelete(`/api/sessions/${sessionId}/agents/${agentId}`);

export const activateAgent = (sessionId: string, agentId: string, direction: "inbound" | "outbound") =>
  apiPost<{ status: string }>(`/api/sessions/${sessionId}/agents/${agentId}/set-active`, { direction });

export const deactivateAgent = async (sessionId: string, agentId: string, direction: "inbound" | "outbound"): Promise<void> => {
  // Get current agent state and clear the direction
  const agents = await listAgents(sessionId);
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) return;
  await apiPut<{ status: string }>(`/api/sessions/${sessionId}/agents/${agentId}`, {
    name: agent.name,
    description: agent.description,
    aiConfig: JSON.stringify(agent.aiConfig),
    inbound: direction === "inbound" ? false : agent.inbound,
    outbound: direction === "outbound" ? false : agent.outbound,
  });
};
