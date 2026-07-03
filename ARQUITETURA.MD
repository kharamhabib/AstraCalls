# Arquitetura do Sistema: RockCall

O **RockCall** (anteriormente WaCalls) é uma plataforma VoIP profissional baseada em WhatsApp que permite realizar e receber chamadas de voz diretamente pelo navegador. O sistema suporta dois modos de operação para a **API Gemini Live** (Google), permitindo que agentes de voz inteligentes (IA) atendam ou façam ligações automáticas de forma natural:

1. **Client-Side (Híbrida/Legada)**: O áudio é roteado através do navegador do operador, que gerencia a conexão WebSocket com a IA.
2. **Server-Side (Autônoma/Nova)**: O servidor Go gerencia tudo diretamente em background (WebSocket + CGO Opus + Pipeline de Áudio), sem necessidade de manter abas de navegador abertas.

---

## 1. Visão Geral da Arquitetura

O sistema é dividido em duas partes fundamentais:
1. **Backend (Go)**: Gerencia o ciclo de vida das sessões do WhatsApp, controla chamadas VoIP, encapsula sinalização de mídia WebRTC, realiza a persistência no PostgreSQL, executa o cliente nativo Gemini Live (`gemini_live.go`), orquestra o loop de áudio server-side (`ai_agent.go`) e expõe a API HTTP/SSE.
2. **Frontend (React, TypeScript, Vite)**: Painel do operador que gerencia as conexões de áudio locais (WebRTC), conecta o loop de áudio cliente-side (se o modo autônomo estiver desativado) e coordena as transcrições e status recebidos via Server-Sent Events (SSE).

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                BROWSER (React Frontend)                                │
│                                                                                        │
│ ┌────────────────┐      ┌─────────────────────────┐ (Se Client-Side) ┌────────────────┐│
│ │  Painel Web    │◄────►│    GeminiLiveAgent      │◄───────────────►│ Google Gemini  ││
│ │  (WebRTC Peer) │      │  (Audio Loop & Bridge)  │                 │ (Bidi WebSocket││
│ └───────┬────────┘      └────────────┬────────────┘                 └────────────────┘│
└─────────┼────────────────────────────┼─────────────────────────────────────────────────┘
          │ WebRTC (SDP / Opus)        │ PCM 16kHz / 24kHz
          ▼                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                  BACKEND (Go Server)                                   │
│                                                                                        │
│ ┌────────────────┐      ┌─────────────────────────┐ (Se Server-Side) ┌────────────────┐│
│ │   HTTP/SSE API │◄────►│   ServerAIAgent / CGO   │◄───────────────►│ Google Gemini  ││
│ │ (REST / Events)│      │  (Audio Loop / Codec)   │                 │ (Bidi WebSocket││
│ └────────────────┘      └────────────┬────────────┘                 └────────────────┘│
│                                      ▼                                                 │
│                              SessionManager (VoIP)◄─────────► PostgreSQL (Database)    │
└──────────────────────────────────────┬─────────────────────────────────────────────────┘
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
* **Comunicação Gemini**: WebSocket bidirecional nativo (`github.com/gorilla/websocket`) para comunicação direta com a API Gemini Live.

### Frontend
* **Core**: React 18, TypeScript, Vite
* **Estilização**: CSS modular e Vanilla CSS
* **Estado**: Zustand (Stores globais leves para controle de chamadas e IA)
* **Comunicação**: Event Stream de mão única via SSE (Server-Sent Events) no endpoint `/api/events` e requisições HTTP REST.

---

## 3. Estrutura de Arquivos Principal

```
astracall/AstraCalls/
├── cmd/
│   ├── migrate/                     # Migrações e setup do PostgreSQL
│   └── server/                      # Servidor Go Principal
│       ├── ai_agent.go              # [NOVO] Agente de voz server-side (WA<->Gemini + tools + post-call)
│       ├── ai_scheduler.go          # [NOVO] Scheduler background de ligações programadas do servidor
│       ├── aiconfig.go              # Handlers REST de configuração da IA
│       ├── gemini_live.go           # [NOVO] Cliente WebSocket nativo em Go para a API Gemini Live
│       ├── httpapi.go               # Definição e rotas da API HTTP/WebRTC e SSE
│       ├── server.go                # Inicialização do servidor e acoplamento do scheduler
│       ├── session.go               # Estado de conexão ativa do WhatsApp, VoIP e auto-atendimento server-side
│       ├── sessionmanager.go        # Ciclo de vida e restauração de sessões do banco
│       └── sessionstore.go          # Operações de banco (Postgres)
├── internal/
│   └── voip/
│       ├── call/                    # Máquina de estados das chamadas e CallManager (CGO + Mutexes)
│       │   ├── callmanager.go       # Gerenciador de chamada e sincronização de concorrência
│       │   ├── callmanager_media.go # Processamento de fluxos RTP e de-duplicação de pacotes
│       │   └── callstate.go         # Definição dos estados e transições de chamadas
│       ├── media/                   # Decodificação Opus/PCM e manipulação de fluxos RTP
│       └── signaling/               # Sinalização VoIP do WhatsApp (Accept, Offer, Reject, Transport)
├── client/                          # Código Frontend React/TypeScript
│   ├── index.html                   # Documento raiz rebranded para RockCall
│   └── src/
│       ├── App.tsx                  # Ponto de entrada React com hooks globais de IA ativos
│       ├── components/
│       │   ├── layout/AppShell.tsx  # Layout estrutural rebranded para RockCall
│       │   └── domain/
│       │       ├── call/CallCard.tsx# Cartão de chamada com botão da IA e transcrição SSE
│       │       └── session/AIDialog.tsx # Dialog de voz, toggles de IA e agendamento de ligações
│       ├── hooks/
│       │   ├── useAICallHandler.ts  # Hook de atendimento automático (com suporte a serverSideAI)
│       │   └── useAICallScheduler.ts# Hook de disparo de ligações programadas no client
│       ├── lib/
│       │   ├── gemini-live.ts       # WebSocket Gemini, PCMPlayer e WebRTC Bridge (Client-side)
│       │   └── webrtc.ts            # Gerenciador de conexão RTCPeerConnection local
│       ├── stores/
│       │   └── ai.ts                # Estado global Zustand de IA e transcrições
│       └── types/
│           └── ai.ts                # Definições de tipo para AIConfig e ScheduledCall
```

---

## 4. Pipeline de Áudio com a IA (Gemini Live)

O RockCall suporta duas arquiteturas para processamento e transmissão de áudio da chamada para a IA:

### 4.1 Modo Client-Side (Bridge no Navegador)
A ponte de áudio opera inteiramente do lado do cliente (no navegador do operador). Isso elimina latência de transporte no backend e simplifica a infraestrutura de rede.
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

O RockCall possui três motores de automação em background:

### 5.1 Atendimento Automático (Auto Answer)
* **No Client (React)**: Monitorado por `useAICallHandler.ts`. Se surgir uma chamada recebida (`incoming`) e o `autoAnswer` estiver ativado (com `serverSideAI` desativado), o React efetua a aceitação automática da chamada no backend (`acceptCall`) e acopla o `GeminiLiveAgent` local assim que a chamada transicionar para `connected`.
* **No Server (Go)**: Se `serverSideAI` e `autoAnswer` estiverem ativados, a função `onIncomingOffer` em [session.go](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/cmd/server/session.go) aceita a chamada automaticamente após o tempo de delay configurado em `autoAnswerDelay` (de 0 a 60 segundos). Antes do aceite, o servidor valida se a chamada ainda está tocando e não foi interceptada/atendida por um operador humano, criando o agente autônomo `ServerAIAgent` assim que a chamada atingir o estado `CallStateActive`.


### 5.2 Disparo de Ligações Programadas (Scheduler)
* **No Client (React)**: Executado por `useAICallScheduler.ts` a cada 10 segundos caso `serverSideAI` esteja desativado. Verifica agendamentos vencidos na lista, dispara a chamada e adiciona o ID em `scheduledCallsInProgress` para o handler acoplar a IA local.
* **No Server (Go)**: Gerenciado por `AIScheduler` em [ai_scheduler.go](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/cmd/server/ai_scheduler.go) a cada 10 segundos caso `serverSideAI` esteja ativado. O ticker verifica se há agendamentos que já venceram, marca o agendamento como inativo no PostgreSQL, inicia a chamada ativa via WhatsApp e configura o callback `OnStateChange` para acoplar o `ServerAIAgent` assim que a chamada transicionar para ativa.

### 5.3 Ações Pós-Chamada (Post-Call Actions)
Ao final de uma chamada gerenciada pelo servidor:
1. O agente autônomo recupera o log completo da transcrição gerada durante a chamada.
2. Faz uma chamada via REST API do Gemini para gerar um resumo executivo muito objetivo e profissional.
3. Envia o resumo formatado para o WhatsApp do administrador e do cliente (se configurado).
4. Dispara webhooks HTTP externos com o payload contendo o ID da chamada, resumo, transcrição completa e metadados de duração.

---

## 6. Resiliência, Concorrência e Regras de Segurança

Para suportar chamadas simultâneas estáveis diretamente no servidor e evitar travamentos no processamento de mídia CGO:

* **Proteção Concorrente no Codec (`onRelayData`)**: O WhatsApp estabelece conexão com múltiplos relays de mídia WebRTC, fazendo com que o mesmo pacote RTP seja recebido simultaneamente em goroutines paralelas. Uma `recvMu sync.Mutex` em `CallManager` serializa a descriptografia (SRTP) e decodificação (Opus CGO).
* **De-duplicação de Pacotes RTP**: O `CallManager` mantém um histórico deslizante dos últimos 64 números de sequência RTP recebidos (`rtpHistory`). Se um pacote duplicado for recebido via outro relay de mídia, ele é sumariamente descartado antes de entrar no decodificador CGO, economizando CPU e evitando corrupção de memória.
* **Prevenção de Disparos Concorrentes de Agendamento**: O `AIScheduler` mantém um controle em memória dos IDs de agendamento em trânsito (`triggeringIds`). Isso garante que um agendamento nunca seja disparado duas vezes caso haja lentidão na gravação das configurações no banco de dados. Os agentes e locks são limpos em memória via `CleanupAgent` ao detectar o encerramento da chamada.
* **Isolamento de Sinalização (Filtro de Loopback)**: Eventos do tipo `CallAccept` vindos do WhatsApp são processados apenas se a chamada correspondente em registro for do tipo `Outgoing` (iniciada pelo servidor). Isso impede que o receptor de uma chamada processe o seu próprio recibo de aceitação em loopback como se fosse um aceite do peer remoto, garantindo integridade de estado.
* **Atraso de Auto-Atendimento e Intercepção Humana**: Tanto no cliente quanto no servidor, a IA aguarda o tempo definido pelo slider `autoAnswerDelay` (0 a 60s) antes de aceitar chamadas de entrada. Durante esse intervalo, o operador humano pode atender à chamada no navegador ou no celular. Caso a chamada mude de estado ou seja assumida por um humano, a rotina de auto-atendimento da IA é cancelada imediatamente.
* **Segurança de API Key**: A chave de API do Gemini inserida pelo painel é salva no banco de dados criptografada ou de forma segura vinculada à sessão do WhatsApp. O painel web recupera essa chave para conectar-se diretamente com o endpoint do Google (se client-side), ou o servidor Go a lê no boot da chamada para autenticar o WebSocket (se server-side).
* **Independência de Processo**: O rebranding visual de visualização para **RockCall** foi feito estritamente no frontend (React, HTML). Os pacotes Go, caminhos de importação internos e binários de compilação mantiveram os nomes originais (`wacalls`) para não quebrar referências do sistema de build nativo e das dependências CGO Opus.
* **Persistência de Transcrições**: As falas do usuário e da IA são agrupadas na store do Zustand (`transcripts`) por tempo e por orador (se client-side), ou transmitidas via SSE e salvas temporariamente na memória do agente para geração do resumo (se server-side).
