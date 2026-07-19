import type { AIConfig, ScheduledCall } from "@/types/ai";
import { useAIAgents } from "@/stores/ai";
import { useCalls } from "@/stores/calls";
import { useSessions } from "@/stores/sessions";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { apiUrl } from "@/lib/auth";
import { fetchEventTicket } from "@/lib/event-stream";
import { getAIConfig, setAIConfig } from "@/services/ai";
import { toast } from "sonner";
import { PCMPlayer } from "./pcm-utils";
import { GeminiLiveSession, type ToolArgs, type ToolResult } from "./gemini-session";
import { DEFAULT_TOOL_PROMPTS, FETCH_CHATWOOT_HISTORY_PROMPT, TOOL_RULES_HEADER } from "./default-prompts";
import { parseScheduledCalls } from "./scheduled-calls";
import { formatPhoneNumber } from "@/utils/format";

export { parseScheduledCalls };

// isMaskedKey detecta a key mascarada pelo GET do backend ("abc•••••xyz"):
// nesse caso a key real NUNCA chega ao navegador e usamos o proxy do servidor.
const isMaskedKey = (key: string): boolean => key === "" || key.includes("•");

// buildGeminiWsUrl monta a URL do WebSocket do Gemini Live. Com a key real,
// conecta direto no Google (legado); com key mascarada, passa pelo proxy do
// backend autenticado por ticket de uso único.
const buildGeminiWsUrl = async (sid: string, geminiApiKey: string): Promise<string> => {
  if (!isMaskedKey(geminiApiKey)) {
    return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${geminiApiKey}`;
  }
  const ticket = await fetchEventTicket();
  const httpUrl = apiUrl(`/api/sessions/${sid}/gemini/ws?ticket=${encodeURIComponent(ticket)}`);
  return httpUrl.replace(/^http/, "ws");
};

type ContactInfo = { jid: string; phone: string; name: string; pictureUrl: string };


// GeminiLiveAgent orquestra o agente de voz IA conectado à chamada WebRTC (modo client-side).
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
  private hangupTimer: ReturnType<typeof setTimeout> | null = null;

  private cleanedPhone = "";

  constructor(callId: string, pc: RTCPeerConnection, micStream: MediaStream, remoteStream: MediaStream, config: AIConfig) {
    this.callId = callId;
    this.pc = pc;
    this.micStream = micStream;
    this.remoteStream = remoteStream;
    this.config = config;
  }

  private async fetchContactInfo(sid: string, peer: string): Promise<ContactInfo | null> {
    try {
      return await apiGet<ContactInfo>(`/api/sessions/${sid}/contacts/${encodeURIComponent(peer)}`);
    } catch (e) {
      console.error("[GeminiAgent] Erro ao buscar dados do contato:", e);
      return null;
    }
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
        firstUtterance: customGreeting,
      };
    }

    // Processamento de Tags Dinâmicas no Prompt
    let processedPrompt = (this.config.systemInstruction || "") + extraPrompt;

    if (this.config.toolsEnabled && this.config.predefinedTools) {
      const toolRules: string[] = [];
      for (const name of this.config.predefinedTools) {
        const promptText = this.config.toolPrompts?.[name] || DEFAULT_TOOL_PROMPTS[name];
        if (promptText) {
          toolRules.push(promptText);
        }
      }
      if (toolRules.length > 0) {
        processedPrompt += TOOL_RULES_HEADER + toolRules.join("\n");
      }
    }
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

    let contactName = "Cliente";
    let cleanedPhone = phone;
    if (cleanedPhone.includes("@")) {
      cleanedPhone = cleanedPhone.split("@")[0].split(":")[0].split(".")[0];
    }
    this.cleanedPhone = cleanedPhone;

    let chatwootEnabled = false;
    if (call) {
      const contact = await this.fetchContactInfo(call.sessionId, call.peer);
      if (contact) {
        if (contact.name) contactName = contact.name;
        if (contact.phone) {
          cleanedPhone = contact.phone;
          this.cleanedPhone = contact.phone;
        }
      }

      try {
        // Verifica se Chatwoot está ativado
        const data = await apiGet<{ enabled: boolean }>(`/api/sessions/${call.sessionId}/chatwoot`);
        chatwootEnabled = !!data.enabled;
      } catch (e) {
        console.error("[GeminiAgent] Erro ao verificar Chatwoot:", e);
      }
    }

    if (chatwootEnabled) {
      processedPrompt += "\n\n" + FETCH_CHATWOOT_HISTORY_PROMPT;
    }

    processedPrompt = processedPrompt
      .replace(/\[today\]/g, now)
      .replace(/\[phone\]/g, cleanedPhone)
      .replace(/\[direction\]/g, direction)
      .replace(/\[session_name\]/g, sessionName)
      .replace(/\[contact_name\]/g, contactName)
      .replace(/\[name\]/g, contactName)
      .replace(/\[Nome da Pessoa\]/g, contactName)
      .replace(/\[custom_fields\]/g, this.config.customFields || "");

    this.config = {
      ...this.config,
      systemInstruction: processedPrompt,
      chatwootEnabled,
    };

    // 1. Inicializa a sessão WebSocket com o Gemini (direto ou via proxy do backend)
    const wsUrl = call
      ? await buildGeminiWsUrl(call.sessionId, this.config.geminiApiKey)
      : undefined;
    this.session = new GeminiLiveSession(this.config, wsUrl ? { wsUrl } : undefined);

    // 2. Inicializa o contexto de áudio em 16kHz (taxa ideal do Gemini)
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
      },
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
        if (this.detached) {
          resolve();
          return;
        }
        if (this.player && this.player.isPlaying()) {
          setTimeout(check, 100);
        } else {
          // Pequeno delay adicional para transição suave
          setTimeout(resolve, 1500);
        }
      };
      check();
    });
  }

  async handleToolCall(name: string, args: ToolArgs): Promise<ToolResult> {
    const call = useCalls.getState().calls.find((c) => c.callId === this.callId);

    if (name === "fetch_chatwoot_history") {
      console.log("[GeminiAgent] Tool fetch_chatwoot_history disparada.", args);
      if (!call) return { error: "chamada não encontrada" };
      try {
        const data = await apiGet<{ history: string }>(
          `/api/sessions/${call.sessionId}/chatwoot-history?phone=${encodeURIComponent(this.cleanedPhone)}`,
        );
        if (data && data.history) {
          return { history: data.history };
        }
      } catch (e) {
        console.error("[GeminiAgent] Erro ao buscar histórico do Chatwoot via tool:", e);
      }
      return { error: "histórico do Chatwoot não pôde ser recuperado ou não está configurado" };
    }

    if (name === "hangup") {
      console.log("[GeminiAgent] Tool hangup disparada. Aguardando fim da fala...");
      if (this.hangupTimer) clearTimeout(this.hangupTimer);
      this.hangupTimer = setTimeout(() => {
        void (async () => {
          await this.waitForAudioFinish();
          this.detach().catch(() => {});
          if (call) {
            apiDelete(`/api/sessions/${call.sessionId}/calls/${this.callId}`).catch(() => {});
          }
        })();
      }, 100);
      return { status: "chamada será desligada após a despedida" };
    }

    if (name === "open_ticket") {
      console.log("[GeminiAgent] Tool open_ticket disparada.", args);
      const reason = (args.reason as string) || "";
      if (call) {
        // Notifica o backend para registrar o chamado no histórico
        apiPost(`/api/sessions/${call.sessionId}/history/${this.callId}/ticket`, { reason }).catch(() => {});
        toast.info("A IA registrou um chamado para o cliente.");
      }
      return { status: "chamado aberto com sucesso" };
    }

    if (name === "send_message") {
      console.log("[GeminiAgent] Tool send_message disparada.", args);
      if (!call) return { error: "chamada não encontrada" };
      const to = (args.to as string) || call.peer;
      const text = args.message as string;

      await apiPost(`/api/sessions/${call.sessionId}/messages/text`, { to, text });
      return { status: "mensagem enviada via WhatsApp", recipient: to };
    }

    if (name === "schedule_call") {
      console.log("[GeminiAgent] Tool schedule_call disparada.", args);
      if (!call) return { error: "chamada não encontrada" };
      let datetime = args.datetime as string;
      const prompt = args.prompt as string | undefined;

      if (!datetime) {
        return { error: "data/hora inválida ou vazia" };
      }

      // Se a string não contiver indicador de fuso (Z, + ou -), adiciona o sufixo 'Z' (UTC) por padrão para evitar dupla conversão
      if (datetime && !datetime.endsWith("Z") && !datetime.includes("+") && !/-\d{2}:\d{2}$/.test(datetime)) {
        datetime = `${datetime}Z`;
      }

      const scheduledDate = new Date(datetime);
      if (isNaN(scheduledDate.getTime())) {
        return { error: "formato de data/hora inválido. Use ISO 8601 (YYYY-MM-DDTHH:MM:SSZ)" };
      }

      try {
        let phoneToUse = call.peer;
        const contact = await this.fetchContactInfo(call.sessionId, call.peer);
        if (contact?.phone) {
          phoneToUse = contact.phone;
        }

        const { aiConfig } = await getAIConfig(call.sessionId);
        if (aiConfig) {
          const schedules = parseScheduledCalls(aiConfig.scheduledCalls);

          const newCall: ScheduledCall = {
            id: Math.random().toString(36).substring(2, 11),
            phone: phoneToUse,
            time: scheduledDate.toISOString(),
            active: true,
            prompt: prompt || undefined,
          };

          const nextConfig = {
            ...aiConfig,
            scheduledCalls: JSON.stringify([...schedules, newCall]),
          };

          await setAIConfig(call.sessionId, nextConfig);

          if (useSessions.getState().activeId === call.sessionId) {
            useAIAgents.getState().setActiveSessionConfig(nextConfig);
          }
          console.log(`[GeminiAgent] Sucesso ao reagendar ligação para ${call.peer} em ${scheduledDate.toISOString()}`);
          return { status: "ligação agendada com sucesso", time: scheduledDate.toISOString() };
        }
        return { error: "configuração de IA não encontrada" };
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
    if (!call) return { error: "chamada não encontrada" };

    return apiPost<ToolResult>(`/api/sessions/${call.sessionId}/tool-proxy`, {
      url: tool.webhookUrl,
      payload: args,
    });
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
    const transcriptText = lines.map((l) => `${l.speaker === "ai" ? "IA" : "Cliente"}: ${l.text}`).join("\n");

    console.log("[GeminiAgent] Gerando resumo da chamada...");

    // Busca informações do contato (resolução de LID e nome) para incluir no resumo
    let contactInfoStr = call.peer;
    const contact = await this.fetchContactInfo(call.sessionId, call.peer);
    if (contact) {
      const formattedPhone = formatPhoneNumber(contact.phone || call.peer);
      if (contact.name && contact.name !== (contact.phone || call.peer)) {
        contactInfoStr = `${contact.name} (${formattedPhone})`;
      } else {
        contactInfoStr = formattedPhone;
      }
    }

    const formattedDate = new Date(call.startedAt).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
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

    // Chama a API REST do Gemini — via proxy do backend quando a key está
    // mascarada (a key real nunca sai do servidor).
    const summaryEndpoint = isMaskedKey(this.config.geminiApiKey)
      ? apiUrl(`/api/sessions/${call.sessionId}/gemini/generateContent`)
      : `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.config.geminiApiKey}`;

    const headers: HeadersInit = { "Content-Type": "application/json" };
    let data: { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    if (summaryEndpoint.startsWith(apiUrl(""))) {
      // Proxy do backend: passa pelo guard de auth padrão
      data = await apiPost<typeof data>(
        `/api/sessions/${call.sessionId}/gemini/generateContent`,
        { contents: [{ parts: [{ text: prompt }] }] },
      );
    } else {
      const response = await fetch(summaryEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });
      if (!response.ok) {
        throw new Error(`Erro ao gerar resumo no Gemini (${response.status})`);
      }
      data = await response.json();
    }

    const summary = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!summary) {
      throw new Error("Resposta de resumo vazia");
    }

    console.log("[GeminiAgent] Resumo gerado com sucesso:", summary);

    // Salva o resumo no histórico do backend de forma assíncrona
    apiPost(`/api/sessions/${call.sessionId}/history/${this.callId}/summary`, { summary })
      .then(() => console.log("[GeminiAgent] Resumo salvo no histórico do backend."))
      .catch((e) => console.error("[GeminiAgent] Erro ao salvar resumo no histórico do backend:", e));

    // Salva o resumo no agendamento correspondente (se houver um configurado)
    getAIConfig(call.sessionId)
      .then(async ({ enabled, aiConfig }) => {
        if (enabled && aiConfig) {
          const currentSchedules = parseScheduledCalls(aiConfig.scheduledCalls);

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
      })
      .catch((e) => {
        console.error("[GeminiAgent] Erro ao atualizar resumo no agendamento:", e);
      });

    // Ação 1: Enviar resumo para o Admin
    if (this.config.postCall.sendAdmin && this.config.postCall.adminNumber) {
      console.log("[GeminiAgent] Enviando resumo para o Administrador...");
      await apiPost(`/api/sessions/${call.sessionId}/messages/text`, {
        to: this.config.postCall.adminNumber,
        text: `*Resumo da Chamada com ${call.peer}:*\n\n${summary}`,
      }).catch((e) => console.error("Erro ao enviar resumo ao Admin:", e));
    }

    // Ação 2: Enviar resumo para o Cliente
    if (this.config.postCall.sendClient) {
      console.log("[GeminiAgent] Enviando resumo para o Cliente...");
      await apiPost(`/api/sessions/${call.sessionId}/messages/text`, {
        to: call.peer,
        text: `*Resumo do nosso contato de hoje:*\n\n${summary}`,
      }).catch((e) => console.error("Erro ao enviar resumo ao Cliente:", e));
    }

    // Ação 3: Disparar Webhook pós-chamada com JSON completo
    if (this.config.postCall.webhookEnabled && this.config.postCall.webhookUrl) {
      console.log("[GeminiAgent] Disparando webhook pós-chamada...");
      await apiPost(`/api/sessions/${call.sessionId}/tool-proxy`, {
        url: this.config.postCall.webhookUrl,
        payload: {
          callId: this.callId,
          peer: call.peer,
          direction: call.direction,
          startedAt: new Date(call.startedAt).toISOString(),
          transcript: lines,
          summary,
        },
      }).catch((e) => console.error("Erro ao disparar webhook pós-chamada:", e));
    }
  }

  async detach(): Promise<void> {
    if (this.detached) return;
    this.detached = true;
    console.log("[GeminiAgent] Desacoplando agente de voz...");

    if (this.hangupTimer) {
      clearTimeout(this.hangupTimer);
      this.hangupTimer = null;
    }

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
