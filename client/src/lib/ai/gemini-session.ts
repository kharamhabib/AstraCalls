import type { AIConfig } from "@/types/ai";
import { base64ToFloat32, uint8ToBase64 } from "./pcm-utils";

const GEMINI_LIVE_MODEL = "models/gemini-3.1-flash-live-preview";
const GEMINI_LIVE_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent";

export type ToolArgs = Record<string, unknown>;
export type ToolResult = Record<string, unknown>;
export type ToolCallHandler = (name: string, args: ToolArgs) => Promise<ToolResult>;
export type TextHandler = (speaker: "client" | "ai", text: string) => void;
export type AudioHandler = (data: Float32Array) => void;

type FunctionDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type GeminiSessionOptions = {
  // wsUrl sobrescreve o endpoint do Google — usado para conectar via proxy do
  // backend (/api/sessions/{sid}/gemini/ws), mantendo a API key fora do navegador.
  wsUrl?: string;
};

// GeminiLiveSession gerencia a conexão WebSocket bidirecional com a API Gemini Live.
export class GeminiLiveSession {
  private ws: WebSocket | null = null;
  private config: AIConfig;
  private wsUrlOverride?: string;
  private onAudioReceived: AudioHandler = () => {};
  private onTextReceived: TextHandler = () => {};
  private onToolCallReceived: ToolCallHandler = async () => ({});
  private onCloseCallback: () => void = () => {};
  public isConnected = false;
  public ready = false;

  constructor(config: AIConfig, options?: GeminiSessionOptions) {
    this.config = config;
    this.wsUrlOverride = options?.wsUrl;
  }

  connect(
    onAudio: AudioHandler,
    onText: TextHandler,
    onToolCall: ToolCallHandler,
    onClose?: () => void,
  ): Promise<void> {
    this.onAudioReceived = onAudio;
    this.onTextReceived = onText;
    this.onToolCallReceived = onToolCall;
    if (onClose) this.onCloseCallback = onClose;

    return new Promise((resolve, reject) => {
      const url =
        this.wsUrlOverride ??
        `${GEMINI_LIVE_WS_URL}?key=${this.config.geminiApiKey}`;

      console.log("[GeminiLive] Conectando ao Gemini Live...");
      let settled = false;
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        this.isConnected = true;
        ws.send(JSON.stringify(this.buildSetupPayload()));
      };

      ws.onmessage = async (event) => {
        try {
          let data = event.data;
          if (data instanceof Blob) {
            data = await data.text();
          }
          const msg = JSON.parse(data as string);

          // Aguarda setupComplete antes de resolver a Promise
          if (msg.setupComplete) {
            console.log("[GeminiLive] Conexão ativa com o Gemini Live.");
            this.ready = true;
            settled = true;
            resolve();
            return;
          }

          // Chamadas de Função (Tools)
          if (msg.toolCall) {
            const functionCalls = msg.toolCall.functionCalls;
            if (functionCalls) {
              for (const fc of functionCalls) {
                void this.handleFunctionCall(fc);
              }
            }
          }

          const serverContent = msg.serverContent;
          if (serverContent) {
            // 1. Áudio de saída da IA (Gemini -> Cliente)
            const modelTurn = serverContent.modelTurn;
            if (modelTurn?.parts) {
              for (const part of modelTurn.parts) {
                if (part.inlineData && part.inlineData.data) {
                  const float32 = base64ToFloat32(part.inlineData.data);
                  this.onAudioReceived(float32);
                }
              }
            }

            // 2. Transcrição da fala da IA (Agent)
            if (serverContent.outputTranscription?.text) {
              this.onTextReceived("ai", serverContent.outputTranscription.text);
            }

            // 3. Transcrição da fala do usuário (Client)
            if (serverContent.inputTranscription?.text) {
              this.onTextReceived("client", serverContent.inputTranscription.text);
            }
          }
        } catch (e) {
          console.error("[GeminiLive] Erro no processamento de mensagem", e);
        }
      };

      ws.onerror = (err) => {
        console.error("[GeminiLive] WebSocket error", err);
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      ws.onclose = () => {
        console.log("[GeminiLive] Conexão WebSocket encerrada.");
        this.isConnected = false;
        this.ready = false;
        // Se fechou antes do setupComplete (key inválida, quota, rede), a
        // promise de connect() precisa REJEITAR — antes ficava pendurada para sempre.
        if (!settled) {
          settled = true;
          reject(new Error("WebSocket fechado antes do setupComplete"));
          return;
        }
        this.onCloseCallback();
      };
    });
  }

  private buildSetupPayload(): Record<string, unknown> {
    const toolsPayload: { functionDeclarations: FunctionDeclaration[] }[] = [];
    if (this.config.toolsEnabled) {
      const functionDeclarations: FunctionDeclaration[] = [];

      // Predefinidas
      if (this.config.predefinedTools?.includes("hangup")) {
        functionDeclarations.push({
          name: "hangup",
          description: "Termina a chamada de voz imediatamente e desliga o telefone do cliente.",
          parameters: { type: "OBJECT", properties: {} },
        });
      }

      if (this.config.predefinedTools?.includes("open_ticket")) {
        functionDeclarations.push({
          name: "open_ticket",
          description:
            "Abre um chamado de suporte ou contato para que um atendente humano retorne para o cliente por chat ou ligação.",
          parameters: {
            type: "OBJECT",
            properties: {
              reason: { type: "STRING", description: "O motivo do chamado ou solicitação do cliente." },
            },
          },
        });
      }

      if (this.config.predefinedTools?.includes("send_message")) {
        functionDeclarations.push({
          name: "send_message",
          description:
            "Envia uma mensagem de texto via WhatsApp para o cliente. Use isso para enviar confirmações, comprovantes, links ou qualquer informação por escrito solicitada.",
          parameters: {
            type: "OBJECT",
            properties: {
              message: { type: "STRING", description: "O conteúdo da mensagem a ser enviada por escrito." },
              to: {
                type: "STRING",
                description:
                  "Opcional. O número de telefone do destinatário com DDI (ex: 5511999999999). Se vazio, envia para o próprio cliente atual.",
              },
            },
            required: ["message"],
          },
        });
      }

      if (this.config.predefinedTools?.includes("schedule_call")) {
        functionDeclarations.push({
          name: "schedule_call",
          description:
            "Reagenda ou agenda uma ligação telefônica da IA para este mesmo cliente. Use isso quando o cliente disser que não pode falar no momento, pedir para retornar mais tarde, ou solicitar um lembrete em um horário específico.",
          parameters: {
            type: "OBJECT",
            properties: {
              datetime: {
                type: "STRING",
                description:
                  "Data e Hora do agendamento no formato ISO 8601 em UTC (ex: YYYY-MM-DDTHH:MM:SSZ). Calcule de forma relativa ao horário atual fornecido no prompt.",
              },
              prompt: {
                type: "STRING",
                description:
                  "Instruções específicas ou roteiro de prompt para a IA seguir na próxima chamada. Ex: 'Ligar para confirmar a reunião' ou 'Lembrar de tomar o remédio'.",
              },
            },
            required: ["datetime"],
          },
        });
      }

      // Se Chatwoot estiver habilitado, adiciona a ferramenta fetch_chatwoot_history implicitamente
      if (this.config.chatwootEnabled) {
        functionDeclarations.push({
          name: "fetch_chatwoot_history",
          description:
            "Busca o histórico recente de conversas por texto do Chatwoot para obter contexto do atendimento. Chame essa ferramenta caso o cliente pergunte se você se lembra dele, se tem acesso ao chat, ou se pedir para retomar a conversa anterior.",
          parameters: { type: "OBJECT", properties: {} },
        });
      }

      // Customizadas
      if (this.config.customTools && this.config.customTools.length > 0) {
        for (const ct of this.config.customTools) {
          const properties: Record<string, { type: string; description: string }> = {};
          const required: string[] = [];

          if (ct.parameters) {
            for (const p of ct.parameters) {
              properties[p.name] = {
                type: p.type.toUpperCase(), // STRING, NUMBER, BOOLEAN
                description: p.description,
              };
              if (p.required) {
                required.push(p.name);
              }
            }
          }

          functionDeclarations.push({
            name: ct.name,
            description: ct.description,
            parameters: {
              type: "OBJECT",
              properties,
              required,
            },
          });
        }
      }

      if (functionDeclarations.length > 0) {
        toolsPayload.push({ functionDeclarations });
      }
    }

    return {
      setup: {
        model: GEMINI_LIVE_MODEL,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: this.config.voiceName || "Puck",
              },
            },
            languageCode: this.config.languageCode || "pt-BR",
          },
          temperature: this.config.temperature ?? 1.0,
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction: {
          parts: [{ text: this.config.systemInstruction }],
        },
        ...(toolsPayload.length > 0 ? { tools: toolsPayload } : {}),
      },
    };
  }

  private async handleFunctionCall(fc: { name: string; args: ToolArgs; id: string }): Promise<void> {
    console.log(`[GeminiLive] Recebeu Tool Call do Gemini: ${fc.name}`, fc.args);
    let output: ToolResult = {};
    try {
      output = await this.onToolCallReceived(fc.name, fc.args);
    } catch (e) {
      console.error(`[GeminiLive] Erro ao processar tool ${fc.name}:`, e);
      output = { error: (e as Error).message };
    }

    const payload = {
      toolResponse: {
        functionResponses: [
          {
            name: fc.name,
            id: fc.id,
            response: { output },
          },
        ],
      },
    };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
      console.log(`[GeminiLive] Enviou Tool Response para: ${fc.name}`, output);
    }
  }

  sendAudioChunk(pcmInt16: Int16Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.ready) return;

    // Formato correto da API Gemini Live Bidi: realtimeInput.audio
    const bytes = new Uint8Array(pcmInt16.buffer as ArrayBuffer);
    const base64 = uint8ToBase64(bytes);
    const payload = {
      realtimeInput: {
        audio: {
          data: base64,
          mimeType: "audio/pcm;rate=16000",
        },
      },
    };
    this.ws.send(JSON.stringify(payload));
  }

  sendText(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.ready) return;
    const payload = {
      realtimeInput: {
        text,
      },
    };
    this.ws.send(JSON.stringify(payload));
  }

  close(): void {
    console.log("[GeminiLive] Fechando sessão...");
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.isConnected = false;
    this.ready = false;
  }
}
