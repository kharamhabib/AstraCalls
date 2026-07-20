# Arquitetura do Sistema: Kallia

O **Kallia** (plataforma PABX VoIP desenvolvida a partir de evoluções dos projetos originários **AstraCalls** e **WaCalls**) é uma solução profissional SaaS de atendimento e inteligência de voz baseada em WhatsApp que permite realizar e receber chamadas de voz diretamente pelo navegador, gerenciar múltiplos projetos e conexões, e automatizar atendimentos com agentes de IA (Gemini Live).

O sistema suporta dois modos de operação para a **API Gemini Live** (Google):

1. **Server-Side (Autônoma/Principal)**: O servidor Go gerencia tudo diretamente em background (WebSocket + CGO Opus/MLow + Pipeline de Áudio), sem necessidade de manter abas de navegador abertas. Suporta múltiplos agentes especialistas e transferência de chamadas em tempo real.
2. **Client-Side (Híbrida/Navegador)**: O áudio é roteado através do navegador do operador via WebRTC, gerenciando a conexão com a IA.

---

## 1. Visão Geral da Arquitetura e Multi-Tenancy

O Kallia foi desenhado para operação em formato **SaaS Multi-tenant**:

1. **Projetos e Planos (Billing)**:
   - Planos vinculados ao projeto (`basic`, `advantage`, `expert`), controlando o status (`active` / `inactive`), vigência (`plan_starts_at`, `plan_ends_at`) e o limite de conexões de WhatsApp permitidas (ex: Básico 1 conexão, Advantage 3 conexões, Expert 8 conexões).
2. **Controle de Acesso por Roles (RBAC)**:
   - `appadmin`: Superadministrador com acesso total a todos os projetos, usuários e conexões do sistema.
   - `admin`: Administrador do projeto. Gerencia conexões, API keys, agentes especialistas e usuários do seu próprio projeto.
   - `normal`: Operador convidado. Acesso operacional (efetuar e receber chamadas), sem permissão para criar/deletar conexões, alterar chaves de API ou modificar agentes.
3. **Backend (Go)**:
   - Gerencia o ciclo de vida das sessões do WhatsApp via `whatsmeow`, controla chamadas VoIP, encapsula sinalização WebRTC, realiza a persistência no PostgreSQL (banco por sessão), executa o cliente nativo Gemini Live (`gemini_live.go`), orquestra o loop de áudio server-side (`ai_agent.go`) com transferência de especialistas (`TransferTo`) e expõe a API HTTP/SSE autenticada por JWT.
4. **Frontend (React 19, TypeScript, Vite)**:
   - Painel do operador com Login JWT (sem necessidade de digitar URL do servidor), escopo automático do projeto ativo, discador VoIP, gerenciamento de agentes, histórico interativo e widget embutível para o Chatwoot.

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
│ │ JWT / REST /   │◄────►│ ServerAIAgent / Transfer│◄───────────────►│ Google Gemini  ││
│ │ SSE Broker     │      │ (Agentes Especialistas) │                 │ (Bidi WebSocket││
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

- **Linguagem**: Go (Golang) 1.26+
- **Autenticação**: JWT nativo (HMAC-SHA256) com controle de perfis (`appadmin`, `admin`, `normal`)
- **Banco de Dados**: PostgreSQL (banco principal `kallia_main` + 1 banco por sessão `kallia_<session_id>`, com detecção automática de fallback para bancos legados `wacalls_main`)
- **Processamento de Mídia**: CGO com wrapping de codecs Opus nativos (`opus_mlow` do WhatsApp)
- **Gravação de Áudio Dual-Channel**: Gravação e mixagem estocástica em tempo real dos dois canais de áudio (Cliente + IA) salvas em `storage/recordings/YYYYMMDD_HHMMSS_Contato_CallID.wav` com player autenticado.
- **Protocolo**: Sinalização de VoIP via nós binários do WhatsApp e transporte de mídia UDP (SRTP) intermediado por WebRTC.
- **Comunicação Gemini**: WebSocket bidirecional nativo (`github.com/gorilla/websocket`) para comunicação direta com a API Gemini Live.

### Frontend

- **Core**: React 19, TypeScript, Vite
- **Estilização**: Tailwind CSS v4, Lucide Icons, Design System escuro/claro
- **Estado**: Zustand (Stores globais para controle de chamadas, sessões, autenticação e IA)
- **Comunicação**: Event Stream via SSE (`/api/events`) autenticado por ticket temporário e requisições HTTP REST com Bearer Token.

---

## 3. Estrutura de Arquivos Principal

```
Kallia/
├── cmd/
│   ├── migrate/                     # Migrações e setup de tabelas do PostgreSQL (projects, users, sessions, agents, etc.)
│   └── server/                      # Servidor Go Principal
│       ├── main.go                  # Bootstrap, carregador de .env (KALLIA_*), flags e sinal do SO
│       ├── auth.go                  # Autenticação JWT, login, registro, geração de tickets e middleware RBAC
│       ├── db.go                    # dbProvider com suporte inteligente a namespaces (kallia_main / fallback wacalls)
│       ├── project.go               # Handlers de gerenciamento de projetos, planos e limites de conexões
│       ├── agents.go                # Handlers REST para CRUD e vinculação de Agentes Especialistas por conexão
│       ├── ai_agent.go              # Agente de voz server-side (WA<->Gemini + tools + transfer + post-call)
│       ├── ai_scheduler.go          # Scheduler background de ligações programadas do servidor
│       ├── aiconfig.go              # Handlers REST de configuração da IA
│       ├── authticket.go            # Tickets de uso único (30s) p/ SSE/WebSocket sem exposição de chave na URL
│       ├── gemini_live.go           # Cliente WebSocket nativo em Go para a API Gemini Live
│       ├── gemini_proxy.go          # Proxy WS/REST do Gemini (a key nunca sai do servidor)
│       ├── httpapi.go               # Rotas da API HTTP/WebRTC, SSE, CORS, rate limit, health/metrics
│       ├── safehttp.go              # Guarda anti-SSRF (validação de URL/DNS/IP + redirects)
│       ├── util.go                  # Helpers de fuso, retry HTTP e goroutines seguras (goSafe)
│       ├── server.go                # Inicialização do servidor + hidratação do histórico do banco
│       ├── session.go               # Estado WhatsApp/VoIP, auto-atendimento, attachServerAI
│       ├── sessionmanager.go        # Ciclo de vida e restauração de sessões do banco
│       └── sessionstore.go          # Operações no Postgres + call_history + transcrições + agents
├── internal/
│   └── voip/
│       ├── call/                    # Máquina de estados das chamadas e CallManager (CGO + Mutexes)
│       │   ├── callmanager.go       # Gerenciador + listeners de estado thread-safe (AddStateListener)
│       │   ├── callmanager_media.go # Processamento de fluxos RTP e de-duplicação de pacotes
│       │   └── callstate.go         # Definição dos estados e transições de chamadas
│       ├── media/                   # Decodificação Opus/PCM e manipulação de fluxos RTP
│       └── signaling/               # Sinalização VoIP do WhatsApp (Accept, Offer, Reject, Transport)
├── client/                          # Código Frontend React/TypeScript
│   └── src/
│       ├── App.tsx                  # Ponto de entrada React com rotas autenticadas e modal de login
│       ├── components/
│       │   ├── auth/LoginScreen.tsx # Tela de login simplificada (sem campo de URL do servidor)
│       │   ├── layout/AppShell.tsx  # Layout principal com pill do usuário logado (email/role/projeto)
│       │   └── domain/
│       │       ├── history/HistoryDrawer.tsx # Drawer de histórico com exclusão autenticada de chamadas
│       │       └── session/AIDialog.tsx # Dialog de voz e seleção de agente especialista
│       ├── pages/
│       │   ├── AgentsPage.tsx       # Página dedicada ao CRUD e atribuição de Agentes Especialistas
│       │   └── ConnectionsPage.tsx  # Conexões de WhatsApp escopadas pelo plano do projeto
│       ├── services/
│       │   ├── auth.ts              # Login/Logout e utilitários de token no localStorage (kallia.token)
│       │   ├── agents.ts            # Serviços REST de gerenciamento de agentes
│       │   └── history.ts           # Serviços de busca e exclusão autenticada de histórico
│       └── lib/
│           ├── api.ts               # Cliente HTTP centralizado com injeção automática de Bearer Token
│           └── event-stream.ts      # SSE com ticket de uso único + reconexão manual c/ backoff
```

---

## 4. Multi-Tenancy, Autenticação e Gestão de Planos

### 4.1 Modelo de Dados (PostgreSQL)

O banco principal (`kallia_main`) contém as tabelas fundamentais de controle de contas:

1. **`projects`**:
   - `id`, `name`, `plan` (`basic` | `advantage` | `expert`), `status` (`active` | `inactive`), `plan_starts_at`, `plan_ends_at`.
2. **`users`**:
   - `id`, `email`, `password_hash`, `role` (`appadmin` | `admin` | `normal`), `project_id`.
3. **`sessions`**:
   - `id`, `project_id`, `name`, `jid`, `status`, `api_key` (`kc_...`), `paired`.
4. **`agents`**:
   - `id`, `session_id`, `name`, `prompt`, `greeting`, `voice`, `inbound_enabled`, `outbound_enabled`, `is_default`.

### 4.3 Bootstrap Automático de Usuário, Projeto e Conexões (Deploy Zero-Touch)

Ao inicializar o servidor Go (`newSessionStore`):

- O sistema verifica se a tabela `users` está vazia.
- Se for a primeira execução/deploy, lê do `.env` (ou usa fallbacks padronizados):
  - `KALLIA_ADMIN_EMAIL` (default: `admin@kallia.com`)
  - `KALLIA_ADMIN_PASSWORD` (default: `123456`)
  - `KALLIA_INITIAL_PROJECT_NAME` (default: `Projeto Inicial`)
  - `KALLIA_INITIAL_PROJECT_PLAN` (default: `expert`)
- Cria automaticamente o projeto inicial e o usuário admin de forma atômica.
- **Vínculo Automático de Conexões Existentes**: Executa a migração `UPDATE sessions SET project_id = <projectID> WHERE project_id IS NULL OR project_id = '' OR project_id = 'default'`, vinculando todas as sessões de WhatsApp ativas ou pré-existentes a este projeto recém-criado, evitando qualquer perda de conexões ou históricos durante o deploy.

---

## 5. Agentes de IA e Transferência de Chamadas (Hot-Swap)

### 5.1 Persona Inbound / Outbound por Conexão

Cada conexão do WhatsApp pode estar vinculada a múltiplos agentes especialistas cadastrados no sistema. Os agentes podem ser definidos especificamente para:

- Atendimento de ligações recebidas (**Inbound**).
- Realização de ligações ativas (**Outbound**).
- Ambos ou Agente Padrão.

### 5.2 Transferência Dinâmica entre Agentes (`TransferTo`)

Durante uma chamada em andamento operada pelo `ServerAIAgent`:

1. A IA detecta que o assunto requer um especialista (ex: "Transferir para o suporte técnico").
2. A IA aciona a ferramenta de transferência (`transfer_to_agent`).
3. O método `ServerAIAgent.TransferTo(targetAgentID)` é executado no servidor:
   - Desconecta a sessão atual do Gemini Live de forma limpa.
   - Carrega as instruções e o prompt do novo agente especialista.
   - Conecta a nova sessão do Gemini Live injetando a nova persona e o histórico recente do diálogo.
   - Mantém a mesma mídia VoIP do WhatsApp 100% ativa sem que a ligação caia!

---

## 6. Mídia VoIP, Audio Codec e Resiliência

### 6.1 Codec MLow (Meta Low-bitrate)

- A transmissão de áudio VoIP nativa do WhatsApp exige o codec **MLow**.
- A compilação é realizada via CGO com a flag `-tags mlow` e a biblioteca `libopus_mlow.so` (Linux) ou `opus_mlow.dll` (Windows) presente em `native/`.
- Caso o binário seja compilado sem CGO/MLow, o sistema roda em modo **somente sinalização** (permitindo o pareamento e recebimento do sinal, mas sem áudio).

### 6.2 Modos de Diagnóstico e Fallback de Banco de Dados

Ao iniciar o backend Go, o `dbProvider`:

- Procura a variável primária `KALLIA_PG_URL` (com fallback para `WACALLS_PG_URL`).
- Verifica se existe a namespace `kallia_main`. Se o banco de dados contiver registros legados sob `wacalls_main`, ele utiliza automaticamente o namespace `wacalls` garantindo **zero perda de dados e compatibilidade 100%** com servidores já implantados em produção.

---

## 7. Segurança e Hardening

- **Autenticação por JWT**: Senhas salvas via `bcrypt`. Tokens assinados com HMAC-SHA256 (`KALLIA_JWT_SECRET`).
- **Chaves de Conexão Individuais (`kc_*`)**: Cada conexão de WhatsApp gera uma API key única (`kc_...`) para consumo externo via header `X-Connection-API-Key`.
- **Tickets de Uso Único para SSE/WebSockets**: O SSE (`/api/events`) e os proxies usam tickets gerados via `POST /api/events/ticket` com validade de 30s.
- **Proteção Anti-SSRF (`safehttp.go`)**: URLs externas de mídia e webhooks são validadas contra endereços IP privados/reservados.
- **Isolamento Multi-tenant**: Todas as rotas de gerenciamento filtram os recursos pelo `project_id` do usuário logado.

---

## 8. Manutenção e Atualizações

Sempre que uma nova alteração de arquitetura, tabela de banco de dados ou protocolo de mídia for efetuada, este arquivo **`ARQUITETURA.MD`** deve ser atualizado imediatamente.
