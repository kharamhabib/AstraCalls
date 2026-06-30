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

export type AIConfig = {
  geminiApiKey: string;
  voiceName: string;
  languageCode: string;
  systemInstruction: string;
  autoAnswer: boolean;
  temperature: number;
  maxDurationMin: number;
  silenceOperator: boolean;
  transcribeAudio: boolean;
  scheduledCalls: string; // JSON string contendo o array de ScheduledCall
  firstUtterance?: string;
  toolsEnabled: boolean;
  predefinedTools: string[]; // e.g. ["hangup", "human_transfer", "send_message"]
  customTools: CustomTool[];
  postCall: PostCallActions;
  customFields?: string;
};

export type ScheduledCall = {
  id: string;
  phone: string;
  time: string; // Data/Hora no formato ISO string (ex. 2026-06-28T19:30:00.000Z)
  active: boolean;
  prompt?: string; // Motivo ou roteiro personalizado para a IA seguir na ligação
};
