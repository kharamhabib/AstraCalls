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
};

export type ScheduledCall = {
  id: string;
  phone: string;
  time: string; // Data/Hora no formato ISO string (ex. 2026-06-28T19:30:00.000Z)
  active: boolean;
};
