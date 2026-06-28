# Arquitetura do Sistema: RockCall

O **RockCall** (anteriormente WaCalls) é uma plataforma VoIP profissional baseada em WhatsApp que permite realizar e receber chamadas de voz diretamente pelo navegador. O sistema conta com uma integração nativa cliente-servidor (Client-Side Bridge) com a **API Gemini Live** (Google), permitindo que agentes de voz inteligentes (IA) atendam ou façam ligações automáticas de forma natural.

---

## 1. Visão Geral da Arquitetura

O sistema é dividido em duas partes fundamentais:
1. **Backend (Go)**: Gerencia o ciclo de vida das sessões do WhatsApp, controla chamadas VoIP, encapsula sinalização de mídia WebRTC, realiza a persistência no PostgreSQL e fornece uma API REST para a interface.
2. **Frontend (React, TypeScript, Vite)**: Painel do operador que gerencia as conexões de áudio locais (WebRTC), executa a orquestração do loop de áudio com a IA e coordena as automações em tempo real.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                                BROWSER (React Frontend)                          │
│                                                                                  │
│ ┌────────────────┐      ┌─────────────────────────┐      ┌─────────────────────┐ │
│ │  Painel Web    │◄────►│    GeminiLiveAgent      │◄────►│  Google Gemini Live │ │
│ │  (WebRTC Peer) │      │  (Audio Loop & Bridge)  │      │  (Bidi WebSocket)   │ │
│ └───────┬────────┘      └────────────┬────────────┘      └─────────────────────┘ │
└─────────┼────────────────────────────┼───────────────────────────────────────────┘
          │ WebRTC (SDP / Opus)        │ PCM 16kHz / 24kHz
          ▼                            ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                                  BACKEND (Go Server)                             │
│                                                                                  │
│ ┌────────────────┐      ┌─────────────────────────┐      ┌─────────────────────┐ │
│ │   HTTP/WS API  │◄────►│       SessionManager    │◄────►│     PostgreSQL      │ │
│ │  (REST / Event)│      │   (WA Connection / VoIP)│      │  (sessions table)   │ │
│ └────────────────┘      └─────────────────────────┘      └─────────────────────┘ │
└──────────────────────────────────────┬───────────────────────────────────────────┘
                                       │ VoIP (WhatsApp Prot)
                                       ▼
                              WhatsApp VoIP Server
```

---

## 2. Tecnologias Utilizadas

### Backend
* **Linguagem**: Go (Golang)
* **Banco de Dados**: PostgreSQL (armazenamento de credenciais de pareamento, logs de chamadas e configurações da IA)
* **Processamento de Mídia**: CGO com wrapping de codecs Opus nativos (`opus_mlow` do WhatsApp)
* **Protocolo**: Sinalização de VoIP via nós binários do WhatsApp e transporte de mídia UDP (SRTP) intermediado por WebRTC.

### Frontend
* **Core**: React 18, TypeScript, Vite
* **Estilização**: CSS modular e TailwindCSS
* **Estado**: Zustand (Stores globais leves para controle de chamadas e IA)
* **Comunicação**: Event Stream de mão única via SSE/Long-polling (`/api/events`) e requisições HTTP REST.

---

## 3. Estrutura de Arquivos Principal

```
astracall/AstraCalls/
├── cmd/
│   ├── migrate/                     # Migrações e setup do PostgreSQL
│   └── server/                      # Servidor Go Principal
│       ├── aiconfig.go              # [NOVO] Handlers REST de configuração da IA
│       ├── httpapi.go               # Definição e rotas da API HTTP/WebRTC
│       ├── session.go               # Estado de conexão ativa do WhatsApp e VoIP
│       ├── sessionmanager.go        # Ciclo de vida e restauração de sessões do banco
│       └── sessionstore.go          # Operações de banco (Postgres) e migração da coluna ai_config
├── internal/
│   └── voip/
│       ├── call/                    # Máquina de estados das chamadas e CallManager
│       ├── media/                   # Decodificação Opus/PCM e manipulação de fluxos RTP
│       └── signaling/               # Sinalização VoIP do WhatsApp (Accept, Offer, Reject)
├── client/                          # Código Frontend React/TypeScript
│   ├── index.html                   # Documento raiz rebranded para RockCall
│   └── src/
│       ├── App.tsx                  # Ponto de entrada React com hooks globais de IA ativos
│       ├── components/
│       │   ├── layout/AppShell.tsx  # Layout estrutural rebranded para RockCall
│       │   └── domain/
│       │       ├── call/CallCard.tsx# Cartão de chamada com botão da IA e transcrição
│       │       └── session/AIDialog.tsx # [NOVO] Dialog de voz e agendamentos de ligações
│       ├── hooks/
│       │   ├── useAICallHandler.ts  # [NOVO] Hook de atendimento automático
│       │   └── useAICallScheduler.ts# [NOVO] Hook de disparo de ligações programadas
│       ├── lib/
│       │   ├── gemini-live.ts       # [NOVO] WebSocket Gemini, PCMPlayer e WebRTC Bridge
│       │   └── webrtc.ts            # Gerenciador de conexão RTCPeerConnection local
│       ├── stores/
│       │   └── ai.ts                # [NOVO] Estado global Zustand de IA e transcrições
│       └── types/
│           └── ai.ts                # [NOVO] Definições de tipo para AIConfig e ScheduledCall
```

---

## 4. Pipeline de Áudio com a IA (Gemini Live Bridge)

A ponte de áudio opera inteiramente do lado do cliente (no navegador do operador). Isso elimina latência de transporte no backend e simplifica a infraestrutura de rede.

### 4.1 Captura (Cliente/Chamada → Gemini Live)
1. O navegador estabelece a chamada VoIP e obtém o `remoteStream` (áudio do cliente vindo do WhatsApp).
2. O `AudioContext` do navegador captura esse stream e o converte para **16kHz mono** (taxa ideal exigida pelo Gemini).
3. Um `ScriptProcessorNode` coleta blocos de áudio de 2048 amostras em Float32, converte-os em **PCM 16-bit linear (Int16Array)** e os codifica em Base64.
4. **Prevenção de Interrupção Acidental (Barge-in Control)**: Para evitar que ecos de áudio ou pequenos cliques/ruídos de fundo no canal VoIP silenciem ou cortem a fala da IA acidentalmente, o fluxo do microfone do cliente é ignorado (`onaudioprocess` retorna antecipadamente) enquanto o `PCMPlayer` estiver tocando áudio da IA (`isPlaying() === true`).
5. O chunk de áudio é empacotado em uma mensagem JSON e enviado via WebSocket:
   ```json
   {
     "realtimeInput": {
       "audio": {
         "data": "BASE64_PCM_DATA...",
         "mimeType": "audio/pcm;rate=16000"
       }
     }
   }
   ```

### 4.2 Injeção (Gemini Live → WhatsApp/Chamada)
1. A API Gemini Live processa o áudio do usuário e retorna chunks de áudio de resposta em tempo real a **24kHz** via WebSocket.
2. O arquivo `PCMPlayer` recebe esses buffers Float32 e agenda sua reprodução sequencial e encadeada em um `AudioContext` apontado para o `MediaStreamAudioDestinationNode`. A classe expõe o método `isPlaying()` para detectar se há reprodução ativa baseada no agendador de tempo (`nextStartTime > currentTime`).
3. O `RTCRtpSender` da chamada ativa substitui a trilha do microfone físico do operador pela trilha gerada pela IA utilizando o método nativo:
   ```typescript
   await sender.replaceTrack(aiTrack);
   ```
4. O áudio do Gemini é empacotado no navegador, transmitido via WebRTC SDP ao servidor Go, que por sua vez converte/retransmite as amostras RTP Opus criptografadas em direção aos servidores VoIP do WhatsApp.

---

## 5. Automações e Hooks em Background

O RockCall possui dois motores de automação em background que executam a nível global no React:

### 5.1 Atendimento Automático (`useAICallHandler.ts`)
* Escuta mudanças na store de chamadas.
* Se surgir uma chamada recebida (`incoming`) e o `autoAnswer` estiver ativado nas configurações da IA para aquela sessão:
  1. Efetua a aceitação automática da chamada no backend (`acceptCall`).
  2. Conecta o `GeminiLiveAgent` na chamada assim que o status dela transicionar para `connected`.
  3. **Trava de Inicialização (Race Condition Prevention)**: Utiliza a referência `startingAgentsRef` para bloquear múltiplas tentativas concorrentes de inicialização de agentes de IA para a mesma chamada (decorrentes de disparos paralelos do hook React durante a resolução assíncrona da Promise da API).
  4. Desativa o microfone físico do operador local para manter a privacidade do ambiente.

### 5.2 Disparo de Ligações Programadas (`useAICallScheduler.ts`)
* Executa uma verificação a cada 10 segundos.
* **Prevenção de Sobreposição (Canal Ocupado)**: Caso já exista alguma chamada ativa em andamento (`calls.length > 0`) ou uma chamada recebida tocando (`incoming !== null`), ele pula a verificação para não criar colisões de áudio.
* Se a linha estiver livre, compara os horários salvos no banco. Se o horário de um agendamento ativo passou:
  1. Remove o agendamento da lista (disparo único) e atualiza a configuração no banco PostgreSQL.
  2. Dispara a chamada ativa externa (`startCall`).
  3. Adiciona o ID da chamada gerada na fila `scheduledCallsInProgress`.
  4. Quando a chamada for atendida e transicionar para o estado `connected`, o `useAICallHandler` detectará a chamada programada e acoplará o agente do Gemini Live de forma transparente.

### 5.3 Ligações Manuais Iniciadas por IA via Dialer (`Dialer.tsx`)
O operador pode iniciar uma chamada manual direcionada para o agente de IA:
1. **Ligar com IA (Checkbox)**: Quando marcado, a chamada é disparada pelo dialer. Assim que o ID da chamada é retornado pelo backend, o dialer registra o ID em `scheduledCallsInProgress` na store, fazendo com que o `useAICallHandler` acople automaticamente a IA assim que conectar.
2. **Instrução Adicional (Custom Prompt)**: Permite definir instruções exclusivas para essa ligação (ex: "ligue para Luísa e confirme sua reserva"). Essa instrução é armazenada temporariamente na store Zustand mapeada por `callId` e concatenada às `systemInstruction` da IA quando a conexão WebSocket é estabelecida.
3. **Engajar Primeira Fala (Custom Greeting)**: Força a IA a iniciar a fala assim que a chamada conecta. Se ativo, o dialer ou configuração global envia uma mensagem de texto inicial para o WebSocket do Gemini (`this.session.sendText`), provocando o processamento imediato de resposta de voz (TTS) contendo a saudação configurada.

---

## 6. Pontos Chaves e Regras de Segurança

* **Segurança de API Key**: A chave de API do Gemini inserida pelo painel é salva no banco de dados vinculada à sessão do WhatsApp. O painel web recupera essa chave para conectar-se diretamente com o endpoint do Google.
* **Independência de Processo**: O rebranding visual de visualização para **RockCall** foi feito estritamente no frontend (React, HTML). Os pacotes Go, caminhos de importação internos e binários de compilação mantiveram os nomes originais (`wacalls`) para não quebrar referências do sistema de build nativo e das dependências CGO Opus.
* **Persistência de Transcrições**: As falas do usuário e da IA são agrupadas na store do Zustand (`transcripts`) por tempo e por orador, e renderizadas dinamicamente dentro do `CallCard` ativo.
