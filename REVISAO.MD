# 🔍 REVISÃO TÉCNICA — KALLIA (PABX IA WhatsApp)

> **Data:** 2026-07-19  
> **Revisor:** IA  
> **Escopo:** Backend (Go), Frontend (React/TypeScript), Infraestrutura (Docker/Coolify)  
> **Projeto Base:** AstraCalls / WaCalls → Kallia

---

## 📋 Índice

1. [🔴 Problemas Críticos de Segurança](#-problemas-críticos-de-segurança)
2. [🟠 Bugs e Riscos Potenciais](#-bugs-e-riscos-potenciais)
3. [🟡 Código Duplicado](#-código-duplicado)
4. [🔵 Melhorias de Desempenho](#-melhorias-de-desempenho)
5. [🟢 Melhorias de Qualidade de Código](#-melhorias-de-qualidade-de-código)
6. [⚙️ Infraestrutura e DevOps](#-infraestrutura-e-devops)
7. [📊 Plano de Atualização Priorizado](#-plano-de-atualização-priorizado)

---

## 🔴 Problemas Críticos de Segurança

### SEC-01 — Credenciais do Banco de Dados no `.env` Versionável

**Arquivo:** `.env`  
**Severidade:** 🔴 CRÍTICA > DESNECESSÁRIO É APENAS PARA TESTE O REAL ESTA NO VPS

---

### SEC-02 — API Key Desabilitada por Padrão

**Arquivo:** `cmd/server/httpapi.go:102-107`  
**Severidade:** 🔴 CRÍTICA  
**Status:** A variável `WACALLS_API_KEY` está comentada tanto no `.env` quanto no `.env.example`. Sem ela, **toda a API fica aberta** — qualquer um na rede pode criar sessões, efetuar chamadas, ler histórico, e acessar gravações de áudio.

```go
if apiKey != "" {
    handler = withAuth(handler, apiKey, s.tickets, s.log)
} else {
    s.log.Warn("WACALLS_API_KEY não definida — API completamente ABERTA...")
}
```

**Recomendação:**

- Em produção/staging, **nunca** subir sem `WACALLS_API_KEY`.
- Considerar bloquear o boot sem API key quando não for modo `--debug`.

---

### SEC-03 — Gravações de Áudio Sem Controle de Acesso por Sessão

**Arquivo:** `cmd/server/httpapi.go:1033-1049`  
**Severidade:** 🟠 ALTA  
**Status:** O endpoint `GET /api/sessions/{sid}/recordings/{callId}` recebe `sid` e `callId`, mas `findRecordingPath` busca o arquivo **apenas pelo callId**, ignorando se a gravação pertence àquela sessão:

```go
func (s *server) handleGetCallRecording(w http.ResponseWriter, r *http.Request) {
    sid := r.PathValue("sid")       // ← NÃO usado na busca
    callID := r.PathValue("callId")
    filePath := findRecordingPath(callID) // busca só por callID
    ...
    http.ServeFile(w, r, filePath)
}
```

**Risco:** Um operador da Sessão A pode acessar gravações da Sessão B se souber o callID. Com chamadas nomeadas sequencialmente, isso é trivial.  
**Recomendação:**

- Incluir o `sessionID` no path da gravação (`storage/recordings/<sid>/<file>.wav`).
- Ou validar que o `callID` pertence ao `sid` antes de servir o arquivo.

---

### SEC-04 — `findRecordingPath` Vulnerável a Path Traversal

**Arquivo:** `cmd/server/httpapi.go:1016-1031`  
**Severidade:** 🟠 ALTA  
**Status:** O `callId` é usado diretamente em `filepath.Join` sem sanitização:

```go
exactPath := filepath.Join(recordingsDir, fmt.Sprintf("%s.wav", callID))
```

Se um atacante enviar `callId=../../etc/passwd` (ou equivalente Windows), o `filepath.Join` poderia resolver para fora do diretório de gravações.
**Recomendação:**

- Sanitizar `callId` para conter apenas caracteres alfanuméricos e hifens.
- Verificar com `filepath.Rel` que o path resultante ainda está dentro de `storage/recordings/`.

---

### SEC-05 — Gemini API Key na URL do WebSocket

**Arquivo:** `cmd/server/gemini_live.go:77`  
**Severidade:** 🟡 MÉDIA  
**Status:** A chave da API do Gemini é concatenada diretamente na URL do WebSocket:

```go
url := fmt.Sprintf("wss://generativelanguage.googleapis.com/ws/...?key=%s", g.config.GeminiAPIKey)
```

Se houver logging de URLs de WebSocket (proxies intermediários, WAF, APM), a chave vaza.  
**Recomendação:** Não há alternativa fácil (o Gemini Live exige a key na URL), mas loggers devem ser configurados para redactar este parâmetro. Documentar esta limitação.

---

### SEC-06 — CORS Aberto com Wildcard em Produção

**Arquivo:** `cmd/server/httpapi.go:121-149`  
**Severidade:** 🟡 MÉDIA  
**Status:** Sem `WACALLS_CORS_ORIGINS`, o servidor retorna `Access-Control-Allow-Origin: *`. Combinado com a API key no header, qualquer site malicioso pode fazer chamadas autenticadas se o usuário estiver logado.  
**Recomendação:** Tornar `WACALLS_CORS_ORIGINS` obrigatório em produção.

---

### SEC-07 — `toolWebhookClient` Sem Proteção SSRF

**Arquivo:** `cmd/server/ai_agent.go:27`  
**Severidade:** 🟡 MÉDIA

```go
var toolWebhookClient = &http.Client{Timeout: 10 * time.Second}
```

O `toolWebhookClient` (usado para webhooks de tools customizadas da IA) é um `http.Client` padrão **sem** o `safeHTTPClient` de proteção SSRF. Se o prompt da IA for manipulado para chamar uma tool com URL interna, pode vazar dados internos.  
**Recomendação:** Usar `safeHTTPClient` ou validar a URL com `validateOutboundURL` antes de cada request.

---

## 🟠 Bugs e Riscos Potenciais

### BUG-01 — Nil Pointer no `handleGetContactInfo`

**Arquivo:** `cmd/server/httpapi.go:818`  
**Severidade:** 🟠 ALTA

```go
contact, err := sess.getClient().Store.Contacts.GetContact(r.Context(), jid)
```

Se `sess.getClient()` retornar `nil` (sessão desconectada), ou se `Store.ID == nil` (não pareado), isso causa **panic** (nil pointer dereference). Diferente de `doStartCall` (que verifica `Store.ID == nil`), este handler não tem a mesma proteção.  
**Recomendação:** Usar `pairedSession()` em vez de `sessionByID()`, ou verificar `getClient() != nil` antes de acessar o store.

---

### BUG-02 — `handleHistory` Pode Panic com Sessão Desconectada

**Arquivo:** `cmd/server/httpapi.go:482-496`  
**Severidade:** 🟠 ALTA  
**Status:** Bloco de resolução de LID e contatos chama `sess.getClient().Store.LIDs` e `sess.getClient().Store.Contacts` sem verificar se o client é nil ou se `Store.ID` existe:

```go
if jid.Server == "lid" && sess.getClient() != nil && sess.getClient().Store.LIDs != nil {
```

A primeira verificação está presente, mas logo abaixo:

```go
if sess.getClient() != nil {
    if contact, err := sess.getClient().Store.Contacts.GetContact(...)
```

Há uma condição de corrida: o cliente pode ficar nil entre o check e o acesso (o `getClient()` é atômico mas o contexto entre dois loads é diferente).  
**Recomendação:** Carregar o client uma vez em variável local:

```go
cli := sess.getClient()
if cli == nil { /* skip */ }
```

---

### BUG-03 — `toolproxy` Lê Body Duas Vezes Após Falha JSON

**Arquivo:** `cmd/server/toolproxy.go:55-59`  
**Severidade:** 🟡 BAIXA

```go
if err := json.NewDecoder(limited).Decode(&respPayload); err != nil {
    buf := new(bytes.Buffer)
    _, _ = buf.ReadFrom(limited) // ← limited já foi parcialmente consumido
```

Após `json.Decode` falhar, o `io.LimitReader` já consumiu parte do body. O `buf.ReadFrom` vai ler apenas o restante (ou nada). O fallback de texto pode retornar dados truncados.  
**Recomendação:** Ler todo o body em `[]byte` primeiro, depois tentar `json.Unmarshal`.

---

### BUG-04 — `handleReady` Expõe Mensagem de Erro Interna

**Arquivo:** `cmd/server/httpapi.go:295`

```go
writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "not ready", "error": err.Error()})
```

A mensagem de erro do Postgres pode conter informações internas (hostname, porta, nome do banco).  
**Recomendação:** Em produção, retornar apenas `{"status": "not ready"}` sem o detalhe do erro.

---

### BUG-05 — `recorder.go` Pode Causar Panic por Index Out of Range

**Arquivo:** `cmd/server/recorder.go:99-106`  
**Severidade:** 🟡 MÉDIA

```go
offset := r.inPos - r.basePos
r.ensureCap(offset + uint64(len(pcm)))
for i, s := range pcm {
    r.mixBuf[offset+uint64(i)] += s
}
```

Se `inPos < basePos` (por dessincronização dos streams), o `offset` se torna um valor negativo interpretado como uint64 máximo, causando out-of-range no `mixBuf`.  
**Recomendação:** Adicionar guard:

```go
if r.inPos < r.basePos { r.inPos = r.basePos }
```

---

### BUG-06 — `docker-compose.yaml` Sem Volume de Gravações

**Arquivo:** `docker-compose.yaml`  
**Severidade:** 🟠 ALTA  
O Dockerfile cria `/app/storage/recordings`, mas o `docker-compose.yaml` não monta um volume para ele. As gravações são **perdidas** a cada rebuild do container.  
**Recomendação:** Adicionar ao service `app`:

```yaml
volumes:
  - ./storage:/app/storage
```

---

### BUG-07 — `docker-compose.yaml` Faltando `WACALLS_API_KEY` e Porta HTTP

**Arquivo:** `docker-compose.yaml`  
**Severidade:** 🟡 MÉDIA

- A porta HTTP (8080) não está mapeada (`ports` só tem a UDP/TCP do WebRTC).
- `WACALLS_API_KEY` não está nas variáveis de ambiente do compose.
  **Recomendação:**

```yaml
ports:
  - "8080:8080"
environment:
  - WACALLS_API_KEY=${WACALLS_API_KEY}
```

---

## 🟡 Código Duplicado

### DUP-01 — `formatPhoneNumber` — 4 implementações idênticas

**Arquivos afetados:**
| Arquivo | Tipo |
|---------|------|
| `client/src/utils/format.ts` | Exportada (canônica) ✅ |
| `client/src/components/domain/history/HistoryDrawer.tsx` | Local (duplicada) |
| `client/src/components/domain/schedule/ScheduleCard.tsx` | Local (duplicada) |
| `client/src/components/domain/call/Dialer.tsx` | Local (duplicada) |
| `client/src/lib/ai/agent.ts` | Local (duplicada) |

**Recomendação:** Remover as 4 cópias locais e importar de `@/utils/format` (já existe e está em uso em outros componentes).

---

### DUP-02 — `formatDuration` — 2 implementações idênticas

**Arquivos afetados:**
| Arquivo | Implementação |
|---------|---------------|
| `client/src/components/domain/history/HistoryDrawer.tsx:15` | `formatDuration(startedAt, endedAt)` |
| `client/src/components/domain/history/TranscriptModal.tsx:20` | `formatDuration(startedAt, endedAt)` (cópia exata) |

**Recomendação:** Extrair para `@/utils/format.ts` junto das outras funções de formatação.

---

### DUP-03 — `getInitials` — 4 implementações idênticas

**Arquivos afetados:**
| Arquivo |
|---------|
| `client/src/components/domain/history/HistoryDrawer.tsx:26` |
| `client/src/components/domain/call/CallCard.tsx:65` |
| `client/src/components/domain/call/IncomingCallModal.tsx:59` |
| `client/src/components/domain/schedule/ScheduleCard.tsx:24` |

**Recomendação:** Extrair para `@/utils/format.ts`.

---

### DUP-04 — `resolveContactPhone` duplicada entre backend e httpapi

**Arquivos afetados:**
| Arquivo | Função |
|---------|--------|
| `cmd/server/httpapi.go:601` | `resolveContactPhoneRaw(ctx, sess, peer)` |
| `cmd/server/ai_agent.go:525` | `(a *ServerAIAgent) resolveContactPhone(ctx)` |
| `cmd/server/httpapi.go:476-497` | Lógica inline de resolução LID → PN (no handler) |

Três variações da mesma lógica (JID → LID → Phone Number).  
**Recomendação:** Unificar em uma única função `resolvePhone(ctx, client, jidStr) string` em `util.go`.

---

### DUP-05 — Lógica de "chamada perdida/recusada" duplicada

**Arquivos afetados:**
| Arquivo |
|---------|
| `client/src/components/domain/history/HistoryDrawer.tsx:63-69` |
| `client/src/pages/DashboardPage.tsx:78-88` |

A mesma condição de `isMissedOrRejected` está duplicada.  
**Recomendação:** Extrair para uma função utilitária `isMissedOrRejected(row: HistoryRow): boolean` em `@/utils/calls.ts`.

---

## 🔵 Melhorias de Desempenho

### PERF-01 — `findRecordingPath` Faz Scan de Diretório em Cada Request

**Arquivo:** `cmd/server/httpapi.go:1016-1031`  
**Impacto:** Toda vez que `/recordings/{callId}` ou `/history` é chamado, `os.ReadDir` faz I/O síncrono listando todos os arquivos. Com centenas de gravações, isso é lento.  
**Recomendação:**

- Guardar o path da gravação no banco (`recording_url` já existe na tabela `call_history`).
- Usar `findRecordingPath` apenas como fallback de migração.

---

### PERF-02 — `handleHistory` Resolve Contatos e LIDs Em Loop Síncrono

**Arquivo:** `cmd/server/httpapi.go:452-523`  
**Impacto:** Para cada linha de histórico (até 50), faz lookup de LID e contato no store do WhatsApp. São N queries serializadas.  
**Recomendação:**

- Cachear a resolução phone→name na memória (TTL curto).
- Ou fazer batch lookup se a API do whatsmeow suportar.

---

### PERF-03 — Frontend `DashboardPage.tsx` Recalcula Métricas em Cada Render

**Arquivo:** `client/src/pages/DashboardPage.tsx:70-98`  
**Impacto:** Os filtros `todayHistory`, `answeredCalls`, `missedCallsCount` são recalculados a cada re-render sem memoização. Com centenas de registros e SSE frequente, causa re-renders desnecessários.  
**Recomendação:** Usar `useMemo` para todas as métricas calculadas:

```tsx
const todayHistory = useMemo(
  () =>
    historyRows.filter(
      (r) => new Date(r.startedAt).toDateString() === todayStr,
    ),
  [historyRows, todayStr],
);
```

---

### PERF-04 — `Broker.history` Cresce Indefinidamente em Memória

**Arquivo:** `cmd/server/broker.go:19`

```go
const maxHistorySize = 500
```

O `maxHistorySize` de 500 é global (não por sessão). Se houver 10 sessões, o broker guarda até 500 registros no total, o que pode ser insuficiente. Porém, o `hydrateHistory` carrega até 100 registros **por sessão** — totalizando potencialmente milhares de registros se houver muitas sessões.  
**Recomendação:** Implementar purge por sessão com limite configurável.

---

### PERF-05 — Bundle do Frontend Acima de 500 kB

**Saída do build:**

```
dist/assets/index-DZLRGBdr.js  546.32 kB │ gzip: 164.71 kB
```

O Vite alerta que o chunk excede 500 kB.  
**Recomendação:**

- Code-split via `React.lazy()` para rotas (`DashboardPage`, `ConnectionsPage`).
- Separar `lucide-react` como chunk vendor via `manualChunks`.

---

## 🟢 Melhorias de Qualidade de Código

### QC-01 — Variáveis de Ambiente Ainda Usam Prefixo `WACALLS_`

**Arquivos:** Todos os `.go`, `.env`, `docker-compose.yaml`, `README.md`  
**Status:** O projeto foi renomeado para **Kallia**, mas todas as variáveis de ambiente mantêm o prefixo `WACALLS_` (ex: `WACALLS_PG_URL`, `WACALLS_API_KEY`, `WACALLS_CORS_ORIGINS`).  
**Recomendação:**

- Migrar para `KALLIA_PG_URL`, `KALLIA_API_KEY` etc, mantendo backward compatibility com os antigos nomes por 1 versão.
- Ou documentar explicitamente que o prefixo `WACALLS_` é mantido intencionalmente.

---

### QC-02 — `localStorage` Keys Usam `wacalls.` (Frontend)

**Arquivo:** `client/src/lib/auth.ts:1-2`

```ts
const URL_KEY = "wacalls.apiUrl";
const KEY_KEY = "wacalls.apiKey";
```

**Recomendação:** Manter por retrocompatibilidade (evita deslogar todos os usuários), mas documentar.

---

### QC-03 — Binários de Produção Commitados no Repositório

**Arquivos no root:**

- `server.exe` (55 MB)
- `wacalls.exe` (55 MB)

Estes binários não deveriam estar no repositório — inflam o histórico do Git.  
**Recomendação:**

- Removê-los do tracking (`git rm --cached`).
- Adicioná-los ao `.gitignore` (que já ignora `*.exe`, mas os arquivos existentes precisam ser desrastreados).

---

### QC-04 — Faltam Testes para Handlers Críticos

**Cobertura atual:**
| Componente | Tem Testes? |
|-----------|------------|
| `bridge.go` | ✅ Sim |
| `broker.go` | ✅ Sim |
| `callregistry.go` | ✅ Sim |
| `callrouting.go` | ✅ Sim |
| `chatwoot.go` | ✅ Sim |
| `gemini_live.go` | ✅ Sim |
| `safehttp.go` | ✅ Sim |
| `httpapi_security` | ✅ Sim |
| `sessionmanager.go` | ✅ Sim |
| `sessionstore.go` | ✅ Sim |
| `recorder.go` | ❌ Não |
| `ai_agent.go` | ❌ Não |
| `ai_scheduler.go` | ❌ Não |
| `messaging.go` | ❌ Não |
| `webhook.go` | ❌ Não |
| `toolproxy.go` | ❌ Não |
| `nps.go` | ❌ Não |
| `followup.go` | ❌ Não |

**Recomendação:** Priorizar testes para `recorder.go` (corretude do WAV) e `ai_agent.go` (lógica de orquestração).

---

### QC-05 — Arquivos Documentais Duplicados e Desatualizados

| Arquivo                     | Status                   |
| --------------------------- | ------------------------ |
| `UPDATE.MD` (30 KB)         | Desatualizado            |
| `UPDATES.MD` (2.5 KB)       | Atualizado               |
| `UPDATES TESTE.MD` (3.4 KB) | Arquivo de teste, sobrou |
| `PRODUCT.md` (2 KB)         | Sem uso aparente         |

**Recomendação:** Consolidar em um único `CHANGELOG.md` ou manter apenas `UPDATES.MD`.

---

### QC-06 — `hasContactName` Declarada Mas Não Usada

**Arquivo:** `client/src/components/domain/history/HistoryDrawer.tsx:54`

```tsx
const hasContactName =
  (row.name || contact?.name) && (row.name || contact?.name) !== row.phone;
```

A variável `hasContactName` é calculada mas usada como `row.name` diretamente na condição do JSX (linha 95).  
**Recomendação:** Usar `hasContactName` no JSX ou removê-la.

---

## ⚙️ Infraestrutura e DevOps

### INFRA-01 — `docker-compose.yaml` Usa `version: '3.8'` (Deprecado)

**Arquivo:** `docker-compose.yaml:1`  
O campo `version` é ignorado pelo Docker Compose v2+ e gera warning.  
**Recomendação:** Remover a linha `version: '3.8'`.

---

### INFRA-02 — Dockerfile Sem `.dockerignore` Adequado

**Arquivo:** `.dockerignore`  
**Status:** O `.dockerignore` atual é mínimo (111 bytes). Sem listar `storage/`, `.git/`, `*.exe`, `node_modules/`, o build context fica **gigante** (> 110 MB por causa dos executáveis).  
**Recomendação:** Atualizar `.dockerignore`:

```
.git
*.exe
storage/
client/node_modules/
client/dist/
.agents/
.impeccable/
.codex/
```

---

### INFRA-03 — Sem Health Check no Container Docker

**Arquivo:** `Dockerfile`  
O container não tem `HEALTHCHECK` instruction. O Coolify e Docker Swarm dependem disso para reiniciar containers com deadlock.  
**Recomendação:**

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:8080/healthz || exit 1
```

---

## 📊 Plano de Atualização Priorizado

### 🔥 Fase 1 — Segurança Imediata (Urgente)

| #   | Item                                                                 | Esforço |
| --- | -------------------------------------------------------------------- | ------- | --------------------------------------------------------- |
| 1   | **SEC-01:** Rotacionar senha do NeonDB                               | 5 min   | > DESNECESSARIO È APENAS DE TESTE o REAL E NO PROPRIO VPS |
| 2   | **SEC-02:** Habilitar `WACALLS_API_KEY` em produção                  | 5 min   |
| 3   | **SEC-03:** Validar `sessionId` nas gravações                        | 30 min  |
| 4   | **SEC-04:** Sanitizar `callId` contra path traversal                 | 15 min  |
| 5   | **BUG-01:** Nil check em `handleGetContactInfo`                      | 5 min   |
| 6   | **BUG-02:** Load client atômico em variável local no `handleHistory` | 10 min  |

### ⚡ Fase 2 — Bugs e Estabilidade (1-2 dias)

| #   | Item                                                            | Esforço |
| --- | --------------------------------------------------------------- | ------- |
| 7   | **BUG-05:** Guard no recorder para `inPos < basePos`            | 10 min  |
| 8   | **BUG-06:** Volume de gravações no docker-compose               | 5 min   |
| 9   | **BUG-07:** Porta HTTP e API key no compose                     | 5 min   |
| 10  | **BUG-03:** Ler body completo antes de tentar JSON no toolproxy | 15 min  |
| 11  | **SEC-07:** SSRF guard no `toolWebhookClient`                   | 15 min  |
| 12  | **QC-03:** Remover binários do Git tracking                     | 10 min  |

### 🧹 Fase 3 — Código Limpo e DRY (2-3 dias)

| #   | Item                                                           | Esforço |
| --- | -------------------------------------------------------------- | ------- |
| 13  | **DUP-01:** Unificar `formatPhoneNumber` (4 cópias → 1 import) | 30 min  |
| 14  | **DUP-02:** Extrair `formatDuration` para `@/utils/format`     | 15 min  |
| 15  | **DUP-03:** Extrair `getInitials` para `@/utils/format`        | 15 min  |
| 16  | **DUP-04:** Unificar `resolveContactPhone` no backend          | 45 min  |
| 17  | **DUP-05:** Extrair `isMissedOrRejected` para utilitário       | 15 min  |
| 18  | **QC-05:** Consolidar arquivos de changelog                    | 15 min  |
| 19  | **QC-06:** Limpar variável `hasContactName`                    | 5 min   |

### 🚀 Fase 4 — Performance e DevOps (3-5 dias)

| #   | Item                                                 | Esforço |
| --- | ---------------------------------------------------- | ------- |
| 20  | **PERF-03:** `useMemo` nas métricas do Dashboard     | 30 min  |
| 21  | **PERF-01:** Cachear path da gravação no banco       | 1h      |
| 22  | **PERF-02:** Cache de resolução phone→name           | 2h      |
| 23  | **PERF-05:** Code-split do frontend                  | 1h      |
| 24  | **INFRA-01:** Remover `version` do compose           | 2 min   |
| 25  | **INFRA-02:** Melhorar `.dockerignore`               | 10 min  |
| 26  | **INFRA-03:** Adicionar `HEALTHCHECK` ao Dockerfile  | 5 min   |
| 27  | **PERF-04:** Limitar histórico em memória por sessão | 1h      |

### 📝 Fase 5 — Qualidade e Testes (Contínuo)

| #   | Item                                                               | Esforço |
| --- | ------------------------------------------------------------------ | ------- |
| 28  | **QC-04:** Testes para `recorder.go`                               | 2h      |
| 29  | **QC-04:** Testes para `ai_agent.go`                               | 3h      |
| 30  | **QC-01:** Migrar prefixo env para `KALLIA_` (com backward compat) | 2h      |
| 31  | **QC-02:** Documentar as keys de localStorage                      | 15 min  |

---

## 📈 Resumo da Revisão

| Categoria      | Total  | Críticos | Altos | Médios | Baixos |
| -------------- | ------ | -------- | ----- | ------ | ------ |
| Segurança      | 7      | 2        | 2     | 3      | 0      |
| Bugs           | 7      | 0        | 3     | 2      | 2      |
| Duplicação     | 5      | —        | —     | —      | —      |
| Performance    | 5      | —        | —     | —      | —      |
| Qualidade      | 6      | —        | —     | —      | —      |
| Infraestrutura | 3      | —        | —     | —      | —      |
| **TOTAL**      | **33** | **2**    | **5** | **5**  | **2**  |

> **Nota:** O código está, de modo geral, **bem estruturado**. O backend tem boa separação de responsabilidades (session → broker → store), proteções de SSRF, rate limiting, auth com tickets de uso único, e o frontend segue padrões modernos (Zustand, React Query, SSE). As issues identificadas são incrementais e não indicam problemas arquiteturais fundamentais.

---

_Documento gerado automaticamente durante revisão técnica. Todas as issues devem ser validadas pelo desenvolvedor responsável antes da implementação._
