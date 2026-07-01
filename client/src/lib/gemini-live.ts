import type { AIConfig, ScheduledCall } from "@/types/ai";
import { useAIAgents } from "@/stores/ai";
import { useCalls } from "@/stores/calls";
import { useSessions } from "@/stores/sessions";
import { getApiKey, apiUrl } from "@/lib/auth";
import { getClientId } from "@/lib/client-id";
import { getAIConfig, setAIConfig } from "@/services/ai";
import { toast } from "sonner";

// Helpers para conversão de áudio e base64
function base64ToFloat32(base64: string): Float32Array {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768.0;
  }
  return float32;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// 1. Classe para reprodução de áudio PCM sequencial e sem ruídos (cliques)
class PCMPlayer {
  private audioCtx: AudioContext;
  private nextStartTime: number = 0;
  private destination: AudioNode;

  constructor(audioCtx: AudioContext, destination: AudioNode) {
    this.audioCtx = audioCtx;
    this.destination = destination;
    this.nextStartTime = this.audioCtx.currentTime;
  }

  playChunk(float32Array: Float32Array, sampleRate: number = 24000) {
    if (float32Array.length === 0) return;
    const buffer = this.audioCtx.createBuffer(1, float32Array.length, sampleRate);
    buffer.copyToChannel(float32Array as any, 0);

    const source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.destination);

    const now = this.audioCtx.currentTime;
    if (this.nextStartTime < now) {
      this.nextStartTime = now;
    }
    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
  }

  isPlaying(): boolean {
    return this.nextStartTime > this.audioCtx.currentTime;
  }
}

// 2. Classe para gerenciar a conexão WebSocket da API Gemini Live
export class GeminiLiveSession {
  private ws: WebSocket | null = null;
  private config: AIConfig;
  private onAudioReceived: (float32: Float32Array) => void = () => {};
  private onTextReceived: (speaker: "client" | "ai", text: string) => void = () => {};
  private onToolCallReceived: (name: string, args: any) => Promise<any> = async () => ({});
  private onCloseCallback: () => void = () => {};
  public isConnected = false;
  public ready = false;

  constructor(config: AIConfig) {
    this.config = config;
  }

  connect(
    onAudio: (data: Float32Array) => void,
    onText: (speaker: "client" | "ai", text: string) => void,
    onToolCall: (name: string, args: any) => Promise<any>,
    onClose?: () => void
  ): Promise<void> {
    this.onAudioReceived = onAudio;
    this.onTextReceived = onText;
    this.onToolCallReceived = onToolCall;
    if (onClose) this.onCloseCallback = onClose;

    return new Promise((resolve, reject) => {
      const apiKey = this.config.geminiApiKey;
      const model = "models/gemini-3.1-flash-live-preview";
      const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;

      console.log("[GeminiLive] Conectando ao Gemini Live...");
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.isConnected = true;

        // Prepara as ferramentas (tools) se habilitadas
        const toolsPayload: any[] = [];
        if (this.config.toolsEnabled) {
          const functionDeclarations: any[] = [];

          // Predefinidas
          if (this.config.predefinedTools?.includes("hangup")) {
            functionDeclarations.push({
              name: "hangup",
              description: "Termina a chamada de voz imediatamente e desliga o telefone do cliente.",
              parameters: { type: "OBJECT", properties: {} }
            });
          }

          if (this.config.predefinedTools?.includes("human_transfer")) {
            functionDeclarations.push({
              name: "human_transfer",
              description: "Transfere a chamada para um atendente humano imediatamente. Use isso quando o cliente solicitar falar com um humano, ou quando o assunto for complexo demais.",
              parameters: { type: "OBJECT", properties: {} }
            });
          }

          if (this.config.predefinedTools?.includes("send_message")) {
            functionDeclarations.push({
              name: "send_message",
              description: "Envia uma mensagem de texto via WhatsApp para o cliente. Use isso para enviar confirmações, comprovantes, links ou qualquer informação por escrito solicitada.",
              parameters: {
                type: "OBJECT",
                properties: {
                  message: { type: "STRING", description: "O conteúdo da mensagem a ser enviada por escrito." },
                  to: { type: "STRING", description: "Opcional. O número de telefone do destinatário com DDI (ex: 5511999999999). Se vazio, envia para o próprio cliente atual." }
                },
                required: ["message"]
              }
            });
          }

          if (this.config.predefinedTools?.includes("schedule_call")) {
            functionDeclarations.push({
              name: "schedule_call",
              description: "Reagenda ou agenda uma ligação telefônica da IA para este mesmo cliente. Use isso quando o cliente disser que não pode falar no momento, pedir para retornar mais tarde, ou solicitar um lembrete em um horário específico.",
              parameters: {
                type: "OBJECT",
                properties: {
                  datetime: {
                    type: "STRING",
                    description: "Data e Hora do agendamento no formato ISO 8601 em UTC (ex: YYYY-MM-DDTHH:MM:SSZ). Calcule de forma relativa ao horário atual fornecido no prompt."
                  },
                  prompt: {
                    type: "STRING",
                    description: "Instruções específicas ou roteiro de prompt para a IA seguir na próxima chamada. Ex: 'Ligar para confirmar a reunião' ou 'Lembrar de tomar o remédio'."
                  }
                },
                required: ["datetime"]
              }
            });
          }

          // Customizadas
          if (this.config.customTools && this.config.customTools.length > 0) {
            for (const ct of this.config.customTools) {
              const properties: any = {};
              const required: string[] = [];

              if (ct.parameters) {
                for (const p of ct.parameters) {
                  properties[p.name] = {
                    type: p.type.toUpperCase(), // STRING, NUMBER, BOOLEAN
                    description: p.description
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
                  required
                }
              });
            }
          }

          if (functionDeclarations.length > 0) {
            toolsPayload.push({ functionDeclarations });
          }
        }

        // Envia mensagem de Setup inicial
        const setupPayload: any = {
          setup: {
            model: model,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: this.config.voiceName || "Puck"
                  }
                },
                languageCode: this.config.languageCode || "pt-BR"
              },
              temperature: this.config.temperature ?? 1.0
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction: {
              parts: [{ text: this.config.systemInstruction }]
            },
            ...(toolsPayload.length > 0 ? { tools: toolsPayload } : {})
          }
        };

        this.ws?.send(JSON.stringify(setupPayload));
      };

      this.ws.onmessage = async (event) => {
        try {
          let data = event.data;
          if (data instanceof Blob) {
            data = await data.text();
          }
          const msg = JSON.parse(data);

          // Aguarda setupComplete antes de resolver a Promise
          if (msg.setupComplete) {
            console.log("[GeminiLive] Conexão ativa com o Gemini Live.");
            this.ready = true;
            resolve();
            return;
          }

          // Chamadas de Função (Tools)
          if (msg.toolCall) {
            const functionCalls = msg.toolCall.functionCalls;
            if (functionCalls) {
              for (const fc of functionCalls) {
                this.handleFunctionCall(fc);
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

      this.ws.onerror = (err) => {
        console.error("[GeminiLive] WebSocket error", err);
        reject(err);
      };

      this.ws.onclose = () => {
        console.log("[GeminiLive] Conexão WebSocket encerrada.");
        this.isConnected = false;
        this.ready = false;
        this.onCloseCallback();
      };
    });
  }

  async handleFunctionCall(fc: { name: string; args: any; id: string }) {
    console.log(`[GeminiLive] Recebeu Tool Call do Gemini: ${fc.name}`, fc.args);
    let output: any = {};
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
            response: { output: output }
          }
        ]
      }
    };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
      console.log(`[GeminiLive] Enviou Tool Response para: ${fc.name}`, output);
    }
  }

  sendAudioChunk(pcmInt16: Int16Array) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.ready) return;

    // Formato correto da API Gemini Live Bidi: realtimeInput.audio
    const bytes = new Uint8Array(pcmInt16.buffer as ArrayBuffer);
    const base64 = uint8ToBase64(bytes);
    const payload = {
      realtimeInput: {
        audio: {
          data: base64,
          mimeType: "audio/pcm;rate=16000"
        }
      }
    };
    this.ws.send(JSON.stringify(payload));
  }

  sendText(text: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.ready) return;
    const payload = {
      realtimeInput: {
        text: text
      }
    };
    this.ws.send(JSON.stringify(payload));
  }

  close() {
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

// 3. Orquestrador Principal do Agente de Voz IA conectado à chamada WebRTC
export class GeminiLiveAgent {
  private callId: string;
  private pc: RTCPeerConnection;
  private micStream: MediaStream;
  private remoteStream: MediaStream;
  private config: AIConfig;

  private session: GeminiLiveSession | null = null;
  private audioCtx: AudioContext | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private mediaDestNode: MediaStreamAudioDestinationNode | null = null;
  private player: PCMPlayer | null = null;
  private detached = false;

  constructor(callId: string, pc: RTCPeerConnection, micStream: MediaStream, remoteStream: MediaStream, config: AIConfig) {
    this.callId = callId;
    this.pc = pc;
    this.micStream = micStream;
    this.remoteStream = remoteStream;
    this.config = config;
  }

  async start(): Promise<void> {
    console.log("[GeminiAgent] Iniciando agente de voz IA.");

    // Recupera e aplica instruções customizadas (adicionais) e saudações do dialer
    const customPrompt = useAIAgents.getState().getAndRemoveCustomPrompt(this.callId);
    let extraPrompt = "";
    if (customPrompt) {
      console.log("[GeminiAgent] Aplicando instrução adicional do dialer.");
      extraPrompt = `\n\nInstrução adicional para esta chamada específica: ${customPrompt}`;
    }

    const customGreeting = useAIAgents.getState().getAndRemoveCustomGreeting(this.callId);
    if (customGreeting !== undefined) {
      console.log("[GeminiAgent] Aplicando primeira fala customizada.");
      this.config = {
        ...this.config,
        firstUtterance: customGreeting
      };
    }

    // Processamento de Tags Dinâmicas no Prompt
    let processedPrompt = (this.config.systemInstruction || "") + extraPrompt;
    const call = useCalls.getState().calls.find((c) => c.callId === this.callId);
    const direction = call?.direction === "inbound" ? "entrada (recebida)" : "saída (efetuada)";
    const phone = call?.peer || "desconhecido";
    const session = useSessions.getState().sessions.find((s) => s.id === call?.sessionId);
    const sessionName = session?.name || "WhatsApp";

    const offset = -new Date().getTimezoneOffset();
    const offsetSign = offset >= 0 ? "+" : "-";
    const offsetHours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
    const offsetMins = String(Math.abs(offset) % 60).padStart(2, "0");
    const timezoneStr = `UTC${offsetSign}${offsetHours}:${offsetMins}`;

    const localTime = new Date().toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const utcTime = new Date().toISOString();
    const now = `${localTime} (${timezoneStr}) / ${utcTime} (UTC)`;

    processedPrompt = processedPrompt
      .replace(/\[today\]/g, now)
      .replace(/\[phone\]/g, phone)
      .replace(/\[direction\]/g, direction)
      .replace(/\[session_name\]/g, sessionName)
      .replace(/\[custom_fields\]/g, this.config.customFields || "");

    this.config = {
      ...this.config,
      systemInstruction: processedPrompt
    };

    // 1. Inicializa a sessão WebSocket com o Gemini
    this.session = new GeminiLiveSession(this.config);

    // 2. Inicializa o contexto de áudio em 16kHz (taxa ideal do Gemini)
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.audioCtx = new AudioContextClass({ sampleRate: 16000 });

    if (this.audioCtx.state === "suspended") {
      await this.audioCtx.resume();
    }

    // 3. Destino de Áudio para injetar a fala da IA no WebRTC
    this.mediaDestNode = this.audioCtx.createMediaStreamDestination();
    this.player = new PCMPlayer(this.audioCtx, this.mediaDestNode);

    // Conecta a sessão WebSocket e aguarda setupComplete
    await this.session.connect(
      (audioData) => {
        this.player?.playChunk(audioData, 24000);
      },
      (speaker, text) => {
        useAIAgents.getState().appendTranscription(this.callId, speaker, text);
      },
      async (name, args) => {
        return this.handleToolCall(name, args);
      },
      () => {
        if (!this.detached) {
          console.warn("[GeminiAgent] Sessão fechou inesperadamente. Desacoplando e transferindo para operador...");
          toast.error("IA desconectou inesperadamente. O controle da ligação foi devolvido para você.");
          this.detach().catch(() => {});
        }
      }
    );

    // Se houver uma primeira fala configurada, envia o texto para a IA falar imediatamente
    if (this.config.firstUtterance && this.config.firstUtterance.trim() !== "") {
      console.log("[GeminiAgent] IA iniciando a conversa (primeira fala).");
      this.session.sendText(this.config.firstUtterance);
    }

    // 4. Captura a voz do cliente vinda do WebRTC e envia ao Gemini
    const remoteSource = this.audioCtx.createMediaStreamSource(this.remoteStream);

    this.processorNode = this.audioCtx.createScriptProcessor(2048, 1, 1);
    this.processorNode.onaudioprocess = (e) => {
      if (!this.session?.isConnected || !this.session?.ready) return;

      // Se a IA estiver ativamente falando, ignoramos o áudio vindo do cliente
      if (this.player && this.player.isPlaying()) return;

      const inputFloat32 = e.inputBuffer.getChannelData(0);

      // Converte Float32 -> Int16 PCM
      const int16Buffer = new Int16Array(inputFloat32.length);
      for (let i = 0; i < inputFloat32.length; i++) {
        const s = Math.max(-1, Math.min(1, inputFloat32[i]));
        int16Buffer[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      this.session.sendAudioChunk(int16Buffer);
    };

    remoteSource.connect(this.processorNode);

    const dummyGain = this.audioCtx.createGain();
    dummyGain.gain.value = 0;
    this.processorNode.connect(dummyGain);
    dummyGain.connect(this.audioCtx.destination);

    // 5. Substitui a trilha do microfone físico pelo áudio da IA no WebRTC
    const sender = this.pc.getSenders().find((s) => s.track && s.track.kind === "audio");
    const aiTrack = this.mediaDestNode.stream.getAudioTracks()[0];
    if (sender && aiTrack) {
      await sender.replaceTrack(aiTrack);
    }

    // Suprime o microfone do operador local
    this.micStream.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });

    useAIAgents.getState().setAgentActive(this.callId, true);
    console.log("[GeminiAgent] Agente de voz IA ativo para a chamada.");
  }

  private async waitForAudioFinish(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.player && this.player.isPlaying()) {
          setTimeout(check, 100);
        } else {
          // Pequeno delay adicional para transição suave
          setTimeout(resolve, 350);
        }
      };
      check();
    });
  }

  async handleToolCall(name: string, args: any): Promise<any> {
    const call = useCalls.getState().calls.find((c) => c.callId === this.callId);

    if (name === "hangup") {
      console.log("[GeminiAgent] Tool hangup disparada. Aguardando fim da fala...");
      setTimeout(async () => {
        await this.waitForAudioFinish();
        this.detach().catch(() => {});
        if (call) {
          fetch(apiUrl(`/api/sessions/${call.sessionId}/calls/${this.callId}`), {
            method: "DELETE",
            headers: {
              "X-API-Key": getApiKey(),
              "X-Client-Id": getClientId(),
            }
          }).catch(() => {});
        }
      }, 100);
      return { status: "chamada será desligada após a despedida" };
    }

    if (name === "human_transfer") {
      console.log("[GeminiAgent] Tool human_transfer disparada. Aguardando fim da fala...");
      setTimeout(async () => {
        await this.waitForAudioFinish();
        this.detach().catch(() => {});
        toast.warning("A IA transferiu a chamada para você! Pegue o fone.");

        // Toca aviso sonoro (synth beep)
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          const ctx = new AudioContextClass();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = "sine";
          osc.frequency.setValueAtTime(880, ctx.currentTime);
          gain.gain.setValueAtTime(0.3, ctx.currentTime);
          osc.start();
          osc.stop(ctx.currentTime + 0.4);
        } catch {}
      }, 100);
      return { status: "transferência iniciada" };
    }

    if (name === "send_message") {
      console.log("[GeminiAgent] Tool send_message disparada.", args);
      if (!call) return { error: "chamada não encontrada" };
      const to = args.to || call.peer;
      const text = args.message;

      const response = await fetch(apiUrl(`/api/sessions/${call.sessionId}/messages/text`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": getApiKey(),
          "X-Client-Id": getClientId(),
        },
        body: JSON.stringify({ to, text })
      });

      if (!response.ok) {
        throw new Error(`Erro ao enviar mensagem (${response.status})`);
      }
      return { status: "mensagem enviada via WhatsApp", recipient: to };
    }

    if (name === "schedule_call") {
      console.log("[GeminiAgent] Tool schedule_call disparada.", args);
      if (!call) return { error: "chamada não encontrada" };
      let datetime = args.datetime;
      const prompt = args.prompt;

      if (!datetime) {
        return { error: "data/hora inválida ou vazia" };
      }

      // Se a string não contiver indicador de fuso (Z, + ou -), adiciona o sufixo 'Z' (UTC) por padrão para evitar dupla conversão
      if (datetime && !datetime.endsWith("Z") && !datetime.includes("+") && !/-\d{2}:\d{2}$/.test(datetime)) {
        datetime = `${datetime}Z`;
      }

      let scheduledDate = new Date(datetime);
      if (isNaN(scheduledDate.getTime())) {
        return { error: "formato de data/hora inválido. Use ISO 8601 (YYYY-MM-DDTHH:MM:SSZ)" };
      }

      try {
        let phoneToUse = call.peer;
        try {
          const response = await fetch(apiUrl(`/api/sessions/${call.sessionId}/contacts/${encodeURIComponent(call.peer)}`), {
            headers: {
              "X-API-Key": getApiKey(),
              "X-Client-Id": getClientId(),
            }
          });
          if (response.ok) {
            const data = await response.json();
            if (data && data.phone) {
              phoneToUse = data.phone;
            }
          }
        } catch (e) {
          console.error("[GeminiAgent] Erro ao buscar telefone do contato:", e);
        }

        const { aiConfig } = await getAIConfig(call.sessionId);
        if (aiConfig) {
          let schedules: ScheduledCall[] = [];
          try {
            schedules = JSON.parse(aiConfig.scheduledCalls || "[]");
          } catch {}

          const newCall: ScheduledCall = {
            id: Math.random().toString(36).substring(2, 11),
            phone: phoneToUse,
            time: scheduledDate.toISOString(),
            active: true,
            prompt: prompt || undefined
          };

          const nextConfig = {
            ...aiConfig,
            scheduledCalls: JSON.stringify([...schedules, newCall])
          };

          await setAIConfig(call.sessionId, nextConfig);
          
          if (useSessions.getState().activeId === call.sessionId) {
            useAIAgents.getState().setActiveSessionConfig(nextConfig);
          }
          console.log(`[GeminiAgent] Sucesso ao reagendar ligação para ${call.peer} em ${scheduledDate.toISOString()}`);
          return { status: "ligação agendada com sucesso", time: scheduledDate.toISOString() };
        } else {
          return { error: "configuração de IA não encontrada" };
        }
      } catch (e) {
        console.error("Erro ao salvar agendamento via tool:", e);
        return { error: `erro ao salvar agendamento: ${(e as Error).message}` };
      }
    }

    // Custom tools (Webhooks proxy)
    console.log(`[GeminiAgent] Tool customizada ${name} disparada.`, args);
    const tool = this.config.customTools?.find((t) => t.name === name);
    if (!tool) {
      throw new Error(`Ferramenta customizada ${name} não cadastrada`);
    }

    const response = await fetch(apiUrl(`/api/sessions/${call?.sessionId}/tool-proxy`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": getApiKey(),
        "X-Client-Id": getClientId(),
      },
      body: JSON.stringify({
        url: tool.webhookUrl,
        payload: args
      })
    });

    if (!response.ok) {
      throw new Error(`Erro no webhook proxy (${response.status})`);
    }
    return response.json();
  }

  async executePostCallActions(): Promise<void> {
    const lines = useAIAgents.getState().transcripts[this.callId];
    if (!lines || lines.length === 0) {
      console.log("[GeminiAgent] Nenhuma transcrição disponível para gerar resumo.");
      return;
    }

    const call = useCalls.getState().calls.find((c) => c.callId === this.callId);
    if (!call) return;

    // Transforma as linhas de transcrição em texto estruturado
    const transcriptText = lines
      .map((l) => `${l.speaker === "ai" ? "IA" : "Cliente"}: ${l.text}`)
      .join("\n");

    console.log("[GeminiAgent] Gerando resumo da chamada...");

    // Busca informações do contato (resolução de LID e nome) para incluir no resumo
    let contactInfoStr = call.peer;
    try {
      const response = await fetch(apiUrl(`/api/sessions/${call.sessionId}/contacts/${encodeURIComponent(call.peer)}`), {
        headers: {
          "X-API-Key": getApiKey(),
          "X-Client-Id": getClientId(),
        }
      });
      if (response.ok) {
        const data = await response.json();
        if (data) {
          const name = data.name;
          const phone = data.phone;

          const formatPhoneNumber = (value: string) => {
            const cleaned = value.replace(/\D/g, "");
            if (cleaned.length === 0) return "";
            if (cleaned.length <= 2) return `+${cleaned}`;
            if (cleaned.length <= 4) return `+${cleaned.slice(0, 2)} (${cleaned.slice(2)}`;
            if (cleaned.length <= 8) return `+${cleaned.slice(0, 2)} (${cleaned.slice(2, 4)}) ${cleaned.slice(4)}`;
            if (cleaned.length <= 12) return `+${cleaned.slice(0, 2)} (${cleaned.slice(2, 4)}) ${cleaned.slice(4, 8)}-${cleaned.slice(8)}`;
            return `+${cleaned.slice(0, 2)} (${cleaned.slice(2, 4)}) ${cleaned.slice(4, 9)}-${cleaned.slice(9, 13)}`;
          };
          const formattedPhone = formatPhoneNumber(phone || call.peer);

          if (name && name !== (phone || call.peer)) {
            contactInfoStr = `${name} (${formattedPhone})`;
          } else {
            contactInfoStr = formattedPhone;
          }
        }
      }
    } catch (e) {
      console.error("[GeminiAgent] Erro ao buscar contato para o resumo:", e);
    }

    // Chama API REST do Gemini para gerar o resumo
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.config.geminiApiKey}`;
    
    const formattedDate = new Date(call.startedAt).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });

    const prompt = `Analise a transcrição abaixo e gere um resumo muito objetivo e formatado para WhatsApp (use *negrito* nos títulos e emojis). Seja extremamente conciso.

📞 *RESUMO DE ATENDIMENTO*
• *Contato*: ${contactInfoStr}
• *Horário*: ${formattedDate}
• *Sentido*: ${call.direction === "inbound" ? "Recebida" : "Efetuada"}

🎯 *Assunto principal*: (máximo 1 frase)
📝 *Pontos tratados*: (máximo 3 tópicos rápidos)
🤝 *Ações/Decisões*: (máximo 2 tópicos rápidos ou "Nenhuma")

Não crie introduções ou conclusões. Resuma diretamente nos tópicos acima.

Transcrição:
${transcriptText}`;

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    if (!response.ok) {
      throw new Error(`Erro ao gerar resumo no Gemini (${response.status})`);
    }

    const data = await response.json();
    const summary = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!summary) {
      throw new Error("Resposta de resumo vazia");
    }

    console.log("[GeminiAgent] Resumo gerado com sucesso:", summary);

    // Salva o resumo no histórico do backend de forma assíncrona
    fetch(apiUrl(`/api/sessions/${call.sessionId}/history/${this.callId}/summary`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": getApiKey(),
        "X-Client-Id": getClientId(),
      },
      body: JSON.stringify({ summary })
    }).then(async (res) => {
      if (res.ok) {
        console.log("[GeminiAgent] Resumo salvo no histórico do backend.");
      } else {
        console.error("[GeminiAgent] Erro ao salvar resumo no histórico do backend:", res.status);
      }
    }).catch((e) => {
      console.error("[GeminiAgent] Erro ao salvar resumo no histórico do backend:", e);
    });

    // Salva o resumo no agendamento correspondente (se houver um configurado)
    getAIConfig(call.sessionId).then(async ({ enabled, aiConfig }) => {
      if (enabled && aiConfig) {
        let currentSchedules: ScheduledCall[] = [];
        try {
          currentSchedules = JSON.parse(aiConfig.scheduledCalls || "[]");
        } catch {}
        
        let found = false;
        const updated = currentSchedules.map((s) => {
          if (s.callId === this.callId) {
            found = true;
            return { ...s, summary };
          }
          return s;
        });

        if (found) {
          const nextConfig = {
            ...aiConfig,
            scheduledCalls: JSON.stringify(updated),
          };
          await setAIConfig(call.sessionId, nextConfig);
          if (useSessions.getState().activeId === call.sessionId) {
            useAIAgents.getState().setActiveSessionConfig(nextConfig);
          }
          console.log("[GeminiAgent] Resumo salvo no agendamento correspondente.");
        }
      }
    }).catch((e) => {
      console.error("[GeminiAgent] Erro ao atualizar resumo no agendamento:", e);
    });

    // Ação 1: Enviar resumo para o Admin
    if (this.config.postCall.sendAdmin && this.config.postCall.adminNumber) {
      console.log("[GeminiAgent] Enviando resumo para o Administrador...");
      await fetch(apiUrl(`/api/sessions/${call.sessionId}/messages/text`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": getApiKey(),
          "X-Client-Id": getClientId(),
        },
        body: JSON.stringify({
          to: this.config.postCall.adminNumber,
          text: `*Resumo da Chamada com ${call.peer}:*\n\n${summary}`
        })
      }).catch((e) => console.error("Erro ao enviar resumo ao Admin:", e));
    }

    // Ação 2: Enviar resumo para o Cliente
    if (this.config.postCall.sendClient) {
      console.log("[GeminiAgent] Enviando resumo para o Cliente...");
      await fetch(apiUrl(`/api/sessions/${call.sessionId}/messages/text`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": getApiKey(),
          "X-Client-Id": getClientId(),
        },
        body: JSON.stringify({
          to: call.peer,
          text: `*Resumo do nosso contato de hoje:*\n\n${summary}`
        })
      }).catch((e) => console.error("Erro ao enviar resumo ao Cliente:", e));
    }

    // Ação 3: Disparar Webhook pós-chamada com JSON completo
    if (this.config.postCall.webhookEnabled && this.config.postCall.webhookUrl) {
      console.log("[GeminiAgent] Disparando webhook pós-chamada...");
      await fetch(apiUrl(`/api/sessions/${call.sessionId}/tool-proxy`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": getApiKey(),
          "X-Client-Id": getClientId(),
        },
        body: JSON.stringify({
          url: this.config.postCall.webhookUrl,
          payload: {
            callId: this.callId,
            peer: call.peer,
            direction: call.direction,
            startedAt: new Date(call.startedAt).toISOString(),
            transcript: lines,
            summary: summary
          }
        })
      }).catch((e) => console.error("Erro ao disparar webhook pós-chamada:", e));
    }
  }

  async detach(): Promise<void> {
    if (this.detached) return;
    this.detached = true;
    console.log("[GeminiAgent] Desacoplando agente de voz...");

    // Imprime a última frase da conversa se houver
    try {
      const lastLines = useAIAgents.getState().transcripts[this.callId];
      if (lastLines && lastLines.length > 0) {
        const last = lastLines[lastLines.length - 1];
        console.log(`[GeminiLive] ${last.speaker === "ai" ? "📝 IA disse:" : "🎤 Cliente disse:"} ${last.text.trim()}`);
      }
    } catch (e) {
      console.error("[GeminiAgent] Erro ao imprimir última frase no console", e);
    }

    // Executa Ações Pós-Chamada se configurado
    if (this.config.postCall?.summaryEnabled) {
      this.executePostCallActions().catch((e) => {
        console.error("[GeminiAgent] Erro nas ações pós-chamada:", e);
      });
    }

    // 1. Restaura o microfone físico original do operador no WebRTC
    try {
      const sender = this.pc.getSenders().find((s) => s.track && s.track.kind === "audio");
      const micTrack = this.micStream.getAudioTracks()[0];
      if (sender && micTrack) {
        await sender.replaceTrack(micTrack);
      }
    } catch (e) {
      console.error("[GeminiAgent] Erro ao restaurar microfone físico", e);
    }

    // Habilita novamente a captura do microfone do operador
    this.micStream.getAudioTracks().forEach((track) => {
      track.enabled = true;
    });

    // 2. Para processamentos e limpa o contexto de áudio
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }

    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }

    // 3. Fecha a conexão WebSocket com o Gemini
    if (this.session) {
      this.session.close();
      this.session = null;
    }

    // Remove o status ativo de IA
    useAIAgents.getState().setAgentActive(this.callId, false);
    console.log("[GeminiAgent] Agente de voz desacoplado.");
  }
}
