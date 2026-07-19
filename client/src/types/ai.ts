export type ToolParam = {
  name: string;
  type: string; // "string" | "number" | "boolean"
  description: string;
  required: boolean;
};

export type CustomTool = {
  name: string;
  description: string;
  webhookUrl: string;
  parameters: ToolParam[];
};

export type PostCallActions = {
  summaryEnabled: boolean;
  sendAdmin: boolean;
  adminNumber: string;
  sendClient: boolean;
  webhookEnabled: boolean;
  webhookUrl: string;
};

export type NPSConfig = {
  enabled: boolean;
  delaySec: number;
  minCallDuration: number;
  supervisorPhone: string;
  messageTemplate: string;
};

export type MissedFollowupConfig = {
  enabled: boolean;
  delaySec: number;
  messageTemplate: string;
};

export type AIConfig = {
  serverSideAI: boolean; // Se true, o servidor gerencia IA de voz e agendamentos autonomamente
  geminiApiKey: string;
  voiceName: string;
  languageCode: string;
  systemInstruction: string;
  autoAnswer: boolean;
  autoAnswerDelay: number;
  temperature: number;
  maxDurationMin: number;
  silenceOperator: boolean;
  transcribeAudio: boolean;
  scheduledCalls: string; // JSON string contendo o array de ScheduledCall
  firstUtterance?: string;
  toolsEnabled: boolean;
  predefinedTools: string[]; // e.g. ["hangup", "open_ticket", "send_message"]
  toolPrompts: Record<string, string>;
  customTools: CustomTool[];
  postCall: PostCallActions;
  nps?: NPSConfig;
  missedFollowup?: MissedFollowupConfig;
  customFields?: string;
  chatwootEnabled?: boolean; // preenchido em runtime pelo agente (não vem do backend)
};

export type ScheduledCall = {
  id: string;
  phone: string;
  time: string; // Data/Hora no formato ISO string (ex. 2026-06-28T19:30:00.000Z)
  active: boolean;
  prompt?: string; // Motivo ou roteiro personalizado para a IA seguir na ligação
  callId?: string; // ID da chamada iniciada por este agendamento
  summary?: string; // Resumo do atendimento gerado ao fim da ligação
};

export type CallRating = {
  id: number;
  sessionId: string;
  callId: string;
  phone: string;
  score: number;
  comment?: string;
  createdAt: string;
};

export type NPSSummary = {
  total: number;
  average: number;
  promoters: number;
  neutrals: number;
  detractors: number;
  npsScore: number;
};
