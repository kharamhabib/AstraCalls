<div align="center">

# 📞 Kallia

**Plataforma PABX VoIP profissional SaaS para WhatsApp com Agentes de IA em Go puro, direto do navegador — pronta para produção.**

Mídia VoIP nativa, multi-tenant (projetos, planos e permissões RBAC), IA de voz Gemini Live, transferência em tempo real entre agentes especialistas, gravação dual-channel, API de mensagens, webhooks, integração nativa com **Chatwoot** e deploy containerizado (Docker / Coolify).

[![Go](https://img.shields.io/badge/Go-1.26+-00ADD8?logo=go&logoColor=white)](https://go.dev)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![whatsmeow](https://img.shields.io/badge/whatsmeow-VoIP-25D366?logo=whatsapp&logoColor=white)](https://github.com/tulir/whatsmeow)
[![pion](https://img.shields.io/badge/pion-WebRTC-FF6B6B)](https://github.com/pion/webrtc)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](#-licença)

</div>

---

> **Kallia** é uma plataforma PABX VoIP desenvolvida a partir de evoluções dos projetos originários **AstraCalls** e [**WaCalls**](https://github.com/JotaDev66/WaCalls) (de [@jotadev66](https://github.com/jotadev66)). Mantém todo o núcleo VoIP nativo em Go e adiciona suporte multi-tenant (projetos, planos de cobrança e perfis de usuário), autenticação JWT, agentes especialistas com transferência de chamadas em tempo real (`TransferTo`), atendimento autônomo por IA Gemini Live, gravação de chamadas no servidor, **PostgreSQL por sessão**, **API de mensagens**, **webhooks**, **integração nativa com Chatwoot** e **deploy em Docker / VPS**. Todos os créditos dos projetos originários estão preservados em [Colaboradores](#-colaboradores).

---

## 📋 Visão Geral

O **Kallia** permite parear múltiplas contas do WhatsApp via **QR code** organizadas por projetos e realizar/receber **chamadas de voz 1:1** diretamente do navegador ou via atendimento 100% autônomo por IA. O microfone do navegador é enviado por **WebRTC (Opus)** para o servidor Go, que transcodifica para o codec **MLow** da Meta e injeta a mídia na malha de **relay SRTP** do WhatsApp — e o caminho inverso traz o áudio do outro lado de volta ao navegador.

Toda a pilha VoIP roda **nativamente em Go**: o codec de voz MLow, a empacotagem **RTP/SRTP**, **STUN**, o transporte **WebRTC/SCTP relay** e a sinalização `<call>`, integrados ao [**whatsmeow**](https://github.com/tulir/whatsmeow) e servidos a um cliente **React 19**. A dependência em C é o codec `opus_mlow` (via cgo) — que pode ser compilado via `-tags mlow`. Sem ela, o servidor roda em modo **somente sinalização**.

---

## 🚀 Recursos e Funcionalidades do Kallia

### 🏢 Multi-Tenancy & Autenticação JWT

- **Login e Registro por E-mail/Senha**: Autenticação segura via `JWT Bearer` no frontend React.
- **Controle de Acesso por Roles (RBAC)**:
  - `appadmin`: Superadministrador com visão global de todos os projetos, usuários e conexões.
  - `admin`: Gerencia seu próprio projeto, membros, chaves de API e agentes de IA.
  - `normal`: Operador com perfil de atendimento (sem permissão para excluir conexões ou alterar configurações críticas).
- **Simplificação de Login**: O frontend detecta automaticamente o servidor atual (`window.location.origin`), dispensando o preenchimento de URLs de servidor.

### 💳 Gestão de Planos & Limites (Billing)

- **Planos por Projeto**: `basic`, `advantage`, `expert`.
- **Limites de Conexão**: Cada plano define a quantidade máxima de WhatsApps conectados em simultâneo (ex: Básico 1 conexão, Advantage 3 conexões, Expert 8 conexões).
- **Controle de Vigência & Status**: Bloqueio automatizado de novas conexões caso o plano do projeto esteja inativo ou vencido.

### 🤖 Agentes Especialistas & Transferência de Chamada (`TransferTo`)

- **Gestão de Agentes / Personas**: Cadastro de múltiplos agentes com prompts, saudações, vozes e funções específicas por conexão.
- **Modos Inbound / Outbound**: Agentes dedicados para receber ligações, fazer chamadas ativas ou atuar como padrão.
- **Transferência ao Vivo (`TransferTo`)**: A IA pode transferir a ligação em andamento para outro agente especialista de forma transparente, mantendo a chamada VoIP do WhatsApp ativa.

### 🔑 Chaves de API por Conexão (`kc_*`)

- Chave de API exclusiva (`kc_...`) gerada automaticamente por conexão para chamadas de API externas isoladas por WhatsApp.

### 🗄️ Persistência em PostgreSQL (1 banco por sessão)

- Modelo de bancos isolados: um banco **principal** (`kallia_main`, com tabelas de projetos, usuários e conexões) + **um banco por sessão** (`kallia_<id>`, com o store do whatsmeow daquela conta).
- **Detecção Inteligente de Legado**: Caso a namespace `kallia_main` não exista mas haja uma base `wacalls_main`, o servidor utiliza automaticamente o namespace legado sem perda de dados.

### 💬 API de Mensagens & Webhooks

- `POST /api/sessions/{sid}/messages/{text|image|audio|video|document}` (envio via base64 ou URL com guarda anti-SSRF).
- `GET/POST/DELETE /api/sessions/{sid}/webhook` com retries e entrega assíncrona.

### 🤝 Integração Nativa e Widget para Chatwoot

- Mensagens e chamadas integradas ao Chatwoot. O `widget.js` embutível permite atender e fazer chamadas diretamente da caixa de entrada do atendente com resolução reativa de contatos.

---

## 🏗️ Arquitetura

```
┌──────────────────────────────────────────────────────────────────────────┐
│              BROWSER (cliente React 19)  +  Widget no Chatwoot           │
│   mic + alto-falante  ·  WebRTC (Opus)  ·  HTTP REST (JWT) + SSE         │
└───────────────────────────────┬──────────────────────────────────────────┘
                                 │  POST /api/sessions/{sid}/calls/{id}/webrtc
                                 │  GET  /api/events (ticket temporário)
                                 ▼
┌──────────────────────────── GO SERVER (cmd/server) ────────────────────────┐
│  SessionManager   registry de contas escopadas por projeto                 │
│  Auth (JWT)       middleware RBAC (appadmin, admin, normal)                │
│  Projects / Plans gestão de planos e limite de conexões por projeto        │
│  Agents           gerenciador de agentes especialistas e transferências    │
│  Broker           hub SSE (sessões, auth, ciclo de vida das chamadas)       │
│  Bridge           ponte pion WebRTC (Opus do navegador ⇄ PCM 16 kHz)        │
│                                                                            │
│  internal/wa      adaptador VoipSocket sobre whatsmeow                     │
│  internal/voip    call · signaling · media · transport · core · wanode     │
└───────────────┬──────────────────────────────────────┬────────────────────┘
                │ sinalização <call>                    │ mídia SRTP
                ▼                                        ▼
        ┌───────────────┐                    ┌──────────────────────┐
        │  WhatsApp WS  │                    │   relay do WhatsApp   │
        │  (whatsmeow)  │                    │  (SRTP sobre SCTP/DC) │
        └───────────────┘                    └──────────────────────┘
                                                         │
                                              ┌──────────────────────┐
                                              │  PostgreSQL 16        │
                                              │  kallia_main + 1/db  │
                                              └──────────────────────┘
```

## 📋 Variáveis de Ambiente (`KALLIA_*`)

| Variável / Flag               | Padrão             | Descrição                                                               |
| ----------------------------- | ------------------ | ----------------------------------------------------------------------- |
| `KALLIA_PG_URL`               | —                  | URL do Postgres (ex.: `postgresql://user:pass@localhost:5432/postgres`) |
| `KALLIA_PG_NAMESPACE`         | `kallia`           | Prefixo dos bancos por sessão                                           |
| `KALLIA_ADMIN_EMAIL`          | `admin@kallia.com` | E-mail do usuário admin criado automaticamente no bootstrap             |
| `KALLIA_ADMIN_PASSWORD`       | `123456`           | Senha do usuário admin inicial                                          |
| `KALLIA_INITIAL_PROJECT_NAME` | `Projeto Inicial`  | Nome do projeto inicial criado no bootstrap                             |
| `KALLIA_INITIAL_PROJECT_PLAN` | `expert`           | Plano inicial do projeto (`basic`\|`advantage`\|`expert`)               |
| `KALLIA_JWT_SECRET`           | —                  | Segredo HMAC para assinatura de tokens JWT                              |
| `KALLIA_MAX_CALLS`            | `8`                | Chamadas simultâneas padrão por sessão                                  |
| `KALLIA_API_KEY`              | —                  | Chave de API mestre global                                              |
| `KALLIA_PUBLIC_IP`            | `auto`             | IP público p/ NAT 1:1 / ICE-TCP (`auto` detecta automaticamente)        |
| `KALLIA_UDP_PORT`             | `50000`            | Porta de mídia VoIP WebRTC                                              |
| `KALLIA_LOG_LEVEL`            | `info`             | Nível de log (`debug\|info\|warn\|error`)                               |
| `KALLIA_CORS_ORIGINS`         | `*`                | Origens CORS permitidas                                                 |
| `KALLIA_TRUSTED_PROXIES`      | —                  | IPs/CIDRs de proxy confiável                                            |
| `KALLIA_ALLOW_PRIVATE_URLS`   | `false`            | Permite destinos de IP privado em tool-proxy/mídia (SSRF)               |

---

## 🔌 API Endpoints Principais

### Autenticação & Usuários

- `POST /api/auth/login` — Login por email/senha (retorna token JWT + dados do usuário).
- `POST /api/auth/register` — Registro de novo usuário/empresa.
- `GET /api/auth/me` — Dados do usuário logado.

### Sessões & Conexões (WhatsApp)

- `GET /api/sessions` — Lista conexões do projeto ativo.
- `POST /api/sessions` — Cria uma nova conexão (valida limite do plano).
- `DELETE /api/sessions/{sid}` — Remove a conexão e derruba o banco da sessão.

### Agentes Especialistas

- `GET /api/sessions/{sid}/agents` — Lista agentes cadastrados na conexão.
- `POST /api/sessions/{sid}/agents` — Cria um novo agente especialista.
- `PUT /api/sessions/{sid}/agents/{agentId}` — Atualiza configurações/prompts do agente.
- `DELETE /api/sessions/{sid}/agents/{agentId}` — Remove o agente especialista.

### Chamadas & Histórico

- `POST /api/sessions/{sid}/calls` — Inicia chamada de saída.
- `POST /api/sessions/{sid}/calls/{id}/accept` — Atende chamada recebida.
- `DELETE /api/sessions/{sid}/calls/{id}` — Encerra chamada ativa.
- `GET /api/sessions/{sid}/history` — Consulta histórico de chamadas.
- `DELETE /api/sessions/{sid}/history/{callId}` — Exclui registro do histórico (autenticado por JWT).

---

## 🧪 Testes

```bash
go test ./...                 # suíte completa backend (auth, VoIP, media, signaling, transport)
cd client && npx tsc --noEmit # verificação estrita de tipos no frontend React
```

---

## 👥 Colaboradores & Créditos

O **Kallia** é construído sobre o excelente trabalho da comunidade e dos desenvolvedores originários do **WaCalls** e **AstraCalls**:

<div align="center">

<a href="https://github.com/jotadev66"><img src="https://github.com/jotadev66.png" width="72" height="72" style="border-radius:50%" alt="jotadev66"/></a>
<a href="https://github.com/edgardmessias"><img src="https://github.com/edgardmessias.png" width="72" height="72" style="border-radius:50%" alt="edgardmessias"/></a>
<a href="https://github.com/w3nder"><img src="https://github.com/w3nder.png" width="72" height="72" style="border-radius:50%" alt="w3nder"/></a>

[**@jotadev66**](https://github.com/jotadev66) · [**@edgardmessias**](https://github.com/edgardmessias) · [**@w3nder**](https://github.com/w3nder)

**Projetos originais:** [WaCalls](https://github.com/JotaDev66/WaCalls) · AstraCalls

</div>
