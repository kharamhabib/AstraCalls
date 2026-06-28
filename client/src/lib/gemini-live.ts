import type { AIConfig } from "@/types/ai";
import { useAIAgents } from "@/stores/ai";

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
  public isConnected = false;
  public ready = false;

  constructor(config: AIConfig) {
    this.config = config;
  }

  connect(
    onAudio: (data: Float32Array) => void,
    onText: (speaker: "client" | "ai", text: string) => void
  ): Promise<void> {
    this.onAudioReceived = onAudio;
    this.onTextReceived = onText;

    return new Promise((resolve, reject) => {
      const apiKey = this.config.geminiApiKey;
      const model = "models/gemini-3.1-flash-live-preview";
      const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;

      console.log("[GeminiLive] Conectando ao Gemini Live...");
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.isConnected = true;

        // Envia mensagem de Setup inicial (seguindo a especificação da API Bidi)
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
            // Sempre habilitar transcrições para depuração e UX
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction: {
              parts: [{ text: this.config.systemInstruction }]
            }
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
      };
    });
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

  constructor(callId: string, pc: RTCPeerConnection, micStream: MediaStream, remoteStream: MediaStream, config: AIConfig) {
    this.callId = callId;
    this.pc = pc;
    this.micStream = micStream;
    this.remoteStream = remoteStream;
    this.config = config;
  }

  async start(): Promise<void> {
    console.log("[GeminiAgent] Iniciando agente de voz IA.");

    // Recupera e aplica instruções customizadas (adicionais) e saudações do dialer para esta chamada específica
    const customPrompt = useAIAgents.getState().getAndRemoveCustomPrompt(this.callId);
    if (customPrompt) {
      console.log("[GeminiAgent] Aplicando instrução adicional do dialer.");
      this.config = {
        ...this.config,
        systemInstruction: `${this.config.systemInstruction}\n\nInstrução adicional para esta chamada específica: ${customPrompt}`
      };
    }

    const customGreeting = useAIAgents.getState().getAndRemoveCustomGreeting(this.callId);
    if (customGreeting !== undefined) {
      console.log("[GeminiAgent] Aplicando primeira fala customizada.");
      this.config = {
        ...this.config,
        firstUtterance: customGreeting
      };
    }

    // 1. Inicializa a sessão WebSocket com o Gemini
    this.session = new GeminiLiveSession(this.config);

    // 2. Inicializa o contexto de áudio em 16kHz (taxa ideal do Gemini)
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.audioCtx = new AudioContextClass({ sampleRate: 16000 });

    // Força a ativação do contexto se ele for criado em estado suspenso
    if (this.audioCtx.state === "suspended") {
      await this.audioCtx.resume();
    }

    // 3. Destino de Áudio para injetar a fala da IA no WebRTC
    this.mediaDestNode = this.audioCtx.createMediaStreamDestination();
    this.player = new PCMPlayer(this.audioCtx, this.mediaDestNode);

    // Conecta a sessão WebSocket e aguarda setupComplete
    await this.session.connect(
      (audioData) => {
        // Envia áudio da IA para o player tocar na direção da chamada
        this.player?.playChunk(audioData, 24000);
      },
      (speaker, text) => {
        // Envia transcrições para a store global em tempo real
        useAIAgents.getState().appendTranscription(this.callId, speaker, text);
      }
    );

    // Se houver uma primeira fala configurada, engaja a conversa enviando o texto para a IA falar imediatamente
    if (this.config.firstUtterance && this.config.firstUtterance.trim() !== "") {
      console.log("[GeminiAgent] IA iniciando a conversa (primeira fala).");
      this.session.sendText(this.config.firstUtterance);
    }

    // 4. Captura a voz do cliente vinda do WebRTC e envia ao Gemini
    const remoteSource = this.audioCtx.createMediaStreamSource(this.remoteStream);

    // ScriptProcessor para rodar em 16kHz e capturar buffer de áudio
    this.processorNode = this.audioCtx.createScriptProcessor(2048, 1, 1);
    this.processorNode.onaudioprocess = (e) => {
      if (!this.session?.isConnected || !this.session?.ready) return;

      // Se a IA estiver ativamente falando (reproduzindo áudio), ignoramos o áudio vindo do cliente
      // para evitar que ecos ou pequenos ruídos/cliques no canal VoIP interrompam a fala da IA
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

    // Nó de ganho 0 necessário para forçar o ScriptProcessor a processar sem emitir eco local
    const dummyGain = this.audioCtx.createGain();
    dummyGain.gain.value = 0;
    this.processorNode.connect(dummyGain);
    dummyGain.connect(this.audioCtx.destination);
    // 5. Substitui a trilha do microfone físico pelo áudio da IA no WebRTC
    const sender = this.pc.getSenders().find((s) => s.track && s.track.kind === "audio");
    const aiTrack = this.mediaDestNode.stream.getAudioTracks()[0];
    if (sender && aiTrack) {
      await sender.replaceTrack(aiTrack);
    } else {
      console.warn("[GeminiAgent] ⚠️ Não encontrou sender de áudio ou aiTrack!", { sender: !!sender, aiTrack: !!aiTrack });
    }

    // Suprime o microfone do operador local (desativa a trilha para não enviar nada)
    this.micStream.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });

    // Registra o agente de IA como ativo para esta chamada
    useAIAgents.getState().setAgentActive(this.callId, true);
    console.log("[GeminiAgent] Agente de voz IA ativo para a chamada.");
  }

  async detach(): Promise<void> {
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
