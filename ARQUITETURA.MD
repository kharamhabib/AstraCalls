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
4. Dispara webhooks HTTP externos enriquecidos com metadados detalhados contendo o ID da chamada, resumo, transcrição completa turn-by-turn, horários de início/fim e duração calculada.

### 5.4 Abertura de Chamados (open_ticket) e Prompts Modulares
* **Ferramenta `open_ticket`**: Substitui a antiga transferência síncrona para humano (`human_transfer`). Quando ativada pela IA, ela atualiza o registro da chamada no broker como `ticketOpened = true` e salva a razão do contato (`reason`). O backend notifica o administrador via WhatsApp (se configurado). A chamada **não** é encerrada de forma automática pelo manipulador da ferramenta, permitindo que a IA continue interagindo livremente e use a ferramenta `hangup` para desligar apenas quando a conversa for concluída.
* **Prompts Modulares e Dinâmicos**: As instruções e regras de execução de cada ferramenta pré-definida (`hangup`, `open_ticket`, `send_message`, `schedule_call`) são configuradas separadamente (editáveis sob cada switch no painel) e salvas no campo `toolPrompts` da configuração. O backend Go (`ai_agent.go`) e o cliente React (`gemini-live.ts`) concatenam de forma automatizada estes prompts específicos ao prompt geral `systemInstruction` antes de iniciar a sessão Gemini Live.

### 5.5 Reconexão do Gemini Live e Contexto de Conversa
* O cliente WebSocket em [gemini_live.go](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/cmd/server/gemini_live.go) implementa retry automático de até 3 tentativas com backoff exponencial (500ms, 1.5s, 3s).
* Durante a queda da conexão WebSocket com o Google, o pipeline de áudio transmite pacotes de silêncio para manter a ligação ativa.
* Ao reconectar com sucesso, a IA recebe a transcrição acumulada da conversa para recuperar o contexto do diálogo e prosseguir sem repetir perguntas.

### 5.6 Persistência de Transcrições
* Ao término de cada chamada de voz IA, a transcrição completa acumulada é gravada no banco de dados na tabela `call_transcripts` via transação SQL otimizada.
* O histórico é exposto via API `GET /api/sessions/{sid}/history/{callId}/transcript` e exibido de forma interativa e expandida com balões de conversa no frontend ([HistoryDrawer.tsx](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/client/src/components/domain/history/HistoryDrawer.tsx)).

---

## 6. Resiliência, Concorrência e Regras de Segurança

Para suportar chamadas simultâneas estáveis diretamente no servidor e evitar travamentos no processamento de mídia CGO:

* **Proteção Concorrente no Codec (`onRelayData`)**: O WhatsApp estabelece conexão com múltiplos relays de mídia WebRTC, fazendo com que o mesmo pacote RTP seja recebido simultaneamente em goroutines paralelas. Uma `recvMu sync.Mutex` em `CallManager` serializa a descriptografia (SRTP) e decodificação (Opus CGO).
* **De-duplicação de Pacotes RTP**: O `CallManager` mantém um histórico deslizante dos últimos 64 números de sequência RTP recebidos (`rtpHistory`). Se um pacote duplicado for recebido via outro relay de mídia, ele é sumariamente descartado antes de entrar no decodificador CGO, economizando CPU e evitando corrupção de memória.
* **Prevenção de Disparos Concorrentes de Agendamento**: O `AIScheduler` mantém um controle em memória dos IDs de agendamento em trânsito (`triggeringIds`). Isso garante que um agendamento nunca seja disparado duas vezes caso haja lentidão na gravação das configurações no banco de dados. Os agentes e locks são limpos em memória via `CleanupAgent` ao detectar o encerramento da chamada.
* **Isolamento de Sinalização (Filtro de Loopback)**: Eventos do tipo `CallAccept` vindos do WhatsApp são processados apenas se a chamada correspondente em registro for do tipo `Outgoing` (iniciada pelo servidor). Isso impede que o receptor de uma chamada processe o seu próprio recibo de aceitação em loopback como se fosse um aceite do peer remoto, garantindo integridade de estado.
* **Atraso de Auto-Atendimento e Intercepção Humana**: Tanto no cliente quanto no servidor, a IA aguarda o tempo definido pelo slider `autoAnswerDelay` (0 a 60s) antes de aceitar chamadas de entrada. Durante esse intervalo, o operador humano pode atender à chamada no navegador ou no celular. Caso a chamada mude de estado ou seja assumida por um humano, a rotina de auto-atendimento da IA é cancelada imediatamente.
* **Segurança e Mascaramento de API Key**: O campo `GeminiAPIKey` é mascarado como `gem•••••xyz` no endpoint de consulta GET do backend, e o endpoint POST de atualização de configuração ignora valores contendo caracteres de máscara (`•`), impedindo a exposição ou sobrescrita acidental da chave real em banco.
* **Prevenção de Vazamento de Memória (MemHistoryLimit)**: O histórico de chamadas em memória do broker é limitado a 500 registros, descartando os itens mais antigos e evitando o crescimento indefinido de uso de RAM no processo Go.
* **Limitação Máxima nas Filas de Áudio**: Os buffers circulares de recebimento e envio de PCM em tempo real são limitados a `800000` samples (~50 segundos de áudio a 16kHz) para comportar rajadas iniciais de áudio enviadas pela API do Gemini Live sem que ocorram truncamentos, mantendo a estabilidade sonora e o consumo de memória sob controle.
* **Rate Limiting no HTTP API**: Implementação de middleware global (10 req/s, burst 30) e rotas críticas (criação de sessão limitada a 1 req/min por IP, início de chamada a 5 req/min por IP) utilizando o algoritmo token bucket e inserindo cabeçalhos padrão `X-RateLimit-*`.
* **Otimização de Polling do Scheduler**: O loop background do `AIScheduler` retorna instantaneamente sem realizar consultas SQL ou parsing de JSON desnecessários caso a contagem de agendamentos cadastrados ativos no servidor seja igual a zero.
* **Desconexão Graceful de Banco de Dados**: Fechamento explícito (`Close()`) das conexões do banco de dados administrativo, principal do whatsmeow e sessões ao encerrar o processo Go.
* **Detecção de Desconexões SSE Mortas**: Goroutines de transmissão SSE monitoram o encerramento de conexão do navegador e encerram a escuta do canal imediatamente ao detectar erro de escrita (ping falho).
* **Independência de Processo**: O rebranding visual de visualização para **RockCall** foi feito estritamente no frontend (React, HTML). Os pacotes Go, caminhos de importação internos e binários de compilação mantiveram os nomes originais (`wacalls`) para não quebrar referências do sistema de build nativo e das dependências CGO Opus.
* **Persistência de Transcrições**: As falas do usuário e da IA são agrupadas na store do Zustand (`transcripts`) por tempo e por orador (se client-side), ou gravadas no banco de dados Postgres via transação SQL ao fim da chamada (se server-side).
* **Filtragem de Eventos Offline na Inicialização**: Ao conectar ao WhatsApp, o servidor descarta silenciosamente chamadas (`CallOffer`) com mais de 1 minuto e mensagens/recibos com mais de 1 hora, impedindo que o backlog offline dispare ringtones fantasma, crie chamadas ativas inválidas ou spamme integrações (Chatwoot/webhooks) com dados antigos.
* **Desativação de History Sync Automático**: O `ManualHistorySyncDownload` é ativado em todas as instâncias do cliente `whatsmeow`, prevenindo o download e processamento de blobs de histórico de conversa que consumiam CPU e banda por vários minutos na inicialização.
* **Alinhamento do browserOpus a 16kHz**: O codec `browserOpus` (utilizado na ponte WebRTC com o navegador do operador) foi alinhado para operar a **16kHz** (com frames de 320 amostras / 20ms) em ambas as direções, em vez de 48kHz. Isso elimina a necessidade de rotinas de upsampling (`Upsample16to48`) e downsampling (`Downsample48to16`) em Go e evita que o navegador envie pacotes Opus em modo SILK que forcem o decodificador CGO (vinculado à biblioteca customizada `opus_mlow` do WhatsApp) a tentar upsampling para 48kHz, o que causava uma assertion fatal no resampler SILK (`assertion failed: 0` em `resampler.c`). O navegador recebe o fluxo Opus a 16kHz e realiza a reprodução a 48kHz nativamente.
* **Prevenção de Crash no Decodificador CGO (SILK Resampler)**: O buffer máximo de saída do decodificador MLow (`mlowMaxOut`) foi ajustado de `1920` para comportar com segurança o tamanho máximo absoluto de um frame Opus válido (120ms) a 16kHz, evitando estouros e falhas de asserção.
* **Watchdog de Conexão de Mídia (Relay Watchdog)**: Durante o estado de chamada ativa, a goroutine de keepalive monitora a conectividade com os relays de mídia do WhatsApp (`m.relay.HasConnection()`). Se a conexão com todos os relays for perdida por mais de 12 segundos (como quando um dos servidores envolvidos na chamada cai ou perde rede), o watchdog é disparado, encerrando a chamada localmente de forma limpa via `m.EndCall(..., EndCallReasonTimeout)`. Isso evita chamadas presas ("órfãs") em estado ativo nos painéis administrativos e servidores remotos (como o VPS).
* **Terminação de Chamada Multi-dispositivo (accepted_elsewhere)**: Ao realizar chamadas a partir de um cliente (como o frontend do RockCall), a rede do WhatsApp propaga a chamada para todos os dispositivos do destinatário. Quando um desses dispositivos aceita a chamada (por exemplo, um celular), o emissor (nosso servidor) recebe a confirmação de aceite. O `CallManager` na função `HandleCallAccept` identifica os outros dispositivos do destinatário que participavam da chamada a partir da lista de participantes (`RelayData.ParticipantJids`) e dispara de forma paralela e assíncrona nós de terminação com motivo `accepted_elsewhere` para cada um deles. Isso notifica os clientes (como o backend/frontend do receptor) para fechar o diálogo de chamada recebida e parar o ringtone imediatamente.
* **Isolamento e Precisão no Envio de Stanzas de Término**: As rotinas que disparam stanzas de cancelamento/término e rejeição (`EndCall` e `RejectCall` no `CallManager`) em goroutines em background utilizam `context.Background()` em vez do contexto HTTP (`r.Context()`), impedindo cancelamentos precoces da sinalização. Adicionalmente, ao receber o ACK do offer, o sistema atualiza `call.CallCreator` com o JID completo contendo o sufixo de dispositivo (ex: `:71`). No encerramento (`EndCall`), stanzas de terminação específicas são direcionadas tanto para o JID base do destinatário quanto para cada um de seus dispositivos individuais (`ParticipantJids` do peer), assegurando que o telefone do destinatário receba e processe o encerramento em qualquer cenário.
* **Correção de Áudio WebRTC no Frontend (Múltiplos Transceivers)**: Correção na lógica de inicialização WebRTC no frontend ([webrtc.ts](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/client/src/lib/webrtc.ts)) para evitar a criação redundante de transceivers de recepção (`recvonly`) adicionais quando o microfone do operador já está ativo e registrando tracks de áudio bidirecionais. Isso resolve o problema de falta de áudio bidirecional em chamadas manuais (sem IA).
* **Detecção de IP Público em Docker Bridge (`detectPublicIP`)**: A função `detectPublicIP()` em [bridge.go](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/cmd/server/bridge.go) foi corrigida para consultar serviços HTTP externos (`api.ipify.org`, `ifconfig.me`, `icanhazip.com`) antes de usar o fallback local (`net.Dial`). Em ambiente Docker bridge (padrão no Coolify), o método anterior retornava o IP interno do container (`172.x.x.x`), fazendo com que o WebRTC do Pion anunciasse candidatos ICE inacessíveis ao navegador externo — resultando em chamadas manuais sem áudio no VPS, enquanto chamadas com IA (que não usam WebRTC browser) funcionavam normalmente.
* **Interrupção e Descarte de Áudio de Saída (Gemini Live)**: Adicionado tratamento para o evento `"interrupted"` do protocolo Gemini Live WebSocket no backend ([gemini_live.go](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/cmd/server/gemini_live.go)). Quando o cliente começa a falar enquanto a IA está discursando, o Gemini Live envia o sinal de interrupção. O backend captura isso e limpa imediatamente a fila de áudio pendente (`a.audioQueue = nil`), evitando que trechos de áudio antigos continuem tocando após a interrupção. O evento é propagado via SSE (`ai-interrupted`) e tanto o frontend React quanto o widget do Chatwoot tratam visualmente adicionando reticências (`...`) à frase interrompida e abrindo um novo bloco para a próxima fala da IA. Para garantir a integridade da compilação de produção (`npm run build`), a definição de eventos do EventSource ([event-stream.ts](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/client/src/lib/event-stream.ts)) foi estendida com o tipo da união do evento `ai-interrupted`.


---

## 7. Integração e Widget do Chatwoot

O sistema conta com uma integração profissional para a plataforma de atendimento omnicanal **Chatwoot**, viabilizando chamadas de voz diretamente do console do atendente.

### 7.1 Widget Flutuante (`widget.js`)
O script injetado na interface do Chatwoot (`super_admin > app_config > internal`) insere um controle global de telefonia na tela do atendente:
* **Bypass de WebRTC no Server-Side AI**: Quando uma ligação é efetuada ou atendida utilizando a IA no servidor (`isServerAI = true`), o widget pula a solicitação de microfone local e a criação de conexões WebRTC no navegador, aliviando o uso de processamento local.
* **Transcrições Unificadas em Tempo Real**: Conecta ao fluxo SSE (`/api/events`) e exibe as falas da IA e do cliente de forma aglutinada e limpa na caixa `#wacalls-transcript`. Os blocos de áudio transmitidos em frações consecutivas pelo mesmo orador são acumulados na mesma linha.
* **Resolução Dinâmica de Contatos**: Ao receber uma chamada de entrada, o widget busca o nome real do cliente e a foto do perfil via `/api/sessions/{sid}/contacts/{jid}` no backend em paralelo com a configuração da IA. A interface renderiza o pop-up de atendimento com o nome do cliente de forma reativa.
* **Controle Inteligente de Ringtone**: O widget dispara o som de chamada recebida instantaneamente. Se a chamada for auto-atendida pela IA (`owner === "__server__"`), o som é interrompido e a tela transiciona de forma automática para "IA em chamada". Se outro operador atender a chamada, o som cessa e a tela flutuante é fechada automaticamente.
* **Resolução de Script com Fallback**: Para contornar o problema de `document.currentScript` retornar `null` em ambientes de injeção dinâmica como o Chatwoot, o widget varre as tags `<script>` do DOM para identificar o elemento do `widget.js` e recuperar corretamente os atributos `BASE` (URL do servidor) e `KEY` (API Key).
* **Correção de Áudio WebRTC e Prevenção de AbortError**: O widget foi corrigido para evitar a criação redundante de transceivers `recvonly` adicionais quando o microfone do operador está ativo (evitando o bug de chamada manual sem som). Além disso, a atribuição do `srcObject` do elemento `<audio>` foi protegida para não reinicializar caso já existam tracks ativas, prevenindo erros de interrupção de reprodução (`AbortError`).


### 7.2 Resolução de Contexto de Chat no Backend (Go)
Para alimentar a IA com o histórico recente de conversas por texto do Chatwoot e evitar que o operador precise estar com a aba certa aberta, o fluxo foi movido inteiramente para o backend Go (`chatwoot.go` e `ai_agent.go`):
1. **Desacoplamento do DOM**: O widget JavaScript não faz mais nenhuma leitura de mensagens no DOM do navegador, blindando o sistema contra quebras devido a atualizações de layout do Chatwoot.
2. **Busca Robusta via API**: Ao instanciar o agente de IA (`NewServerAIAgent`), o servidor Go obtém o telefone do contato (resolvendo JID LID -> PN se necessário). Para chamadas recebidas (inbound), a resolução utiliza `CallCreatorAlt` (alternativa contendo o número real) e o banco de dados de LIDs, salvando o resultado no `CallInfo` (campo `CallerPn`) para que fique disponível no auto-atendimento, aceite manual e consultas do widget.
3. **Resolução de Conversa e Mensagens**: O Go realiza chamadas autenticadas na API do Chatwoot buscando o contato pelo telefone, localiza a conversa ativa aberta ou pendente associada e extrai as últimas 10 mensagens (via `GET /conversations/{id}/messages`).
4. **Alimentação do Gemini**: As mensagens são ordenadas cronologicamente, formatadas e acopladas à diretiva de sistema (`SystemInstruction`) da IA. Desse modo, o agente do Gemini Live atende ou inicia a ligação sabendo exatamente o que foi conversado no chat por texto anteriormente.
5. **Substituição de Tags e Nomes**: As tags do prompt do Gemini (`[contact_name]`, `[name]`, `[Nome da Pessoa]`) são processadas e substituídas utilizando tentativas de JID (bruto, LID e PN resolvido) para obter o nome correto do contato de forma dinâmica no backend e frontend.
6. **Ordenação Fina de Mensagens**: O backend Go inverte o fatiamento do histórico do Chatwoot para obter as mensagens mais recentes (`len(mList)-limit:`) uma vez que o Chatwoot as retorna em ordem cronológica crescente, assegurando que o contexto da IA contenha informações recentes.

### 7.3 Ferramenta de Contexto Dinâmico (`fetch_chatwoot_history`) e Finalização da Ligação (`hangup`)
* **Ferramenta `fetch_chatwoot_history`**: Se a integração com o Chatwoot estiver ativa, a IA (Gemini Live) recebe de forma implícita a capacidade de invocar a ferramenta `fetch_chatwoot_history`. Isso permite ao agente do Gemini buscar o histórico recente de mensagens em tempo real sob demanda, caso o cliente mencione conversas anteriores.
* **Finalização Suave com `hangup`**: Ao acionar a ferramenta de encerramento (`hangup`), o backend Go não encerra a chamada imediatamente. Em vez disso, ele monitora o esvaziamento do buffer de áudio do Gemini (`waitForAudioFinish()`) e aplica um delay suave de 1,5 segundos para que a fala final da IA seja escutada integralmente. O frontend em TypeScript também adota esse delay suave de 1,5 segundos, evitando o corte de áudio das frases finais de despedida.
