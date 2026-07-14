# UPDATE: Correção de Chamadas VoIP Servidor → Servidor

## 📌 Contexto Geral

O AstraCalls suporta chamadas VoIP via WhatsApp em múltiplos cenários: **Servidor→Celular**, **Celular→Servidor**, **Frontend(Browser)→Celular** e **Servidor→Servidor**. Todos os cenários funcionam corretamente **exceto** o último — chamadas entre dois servidores AstraCalls (whatsmeow↔whatsmeow) apresentam dois problemas críticos que impedem o uso em produção.

### Cenários e Status Atual

| Cenário | Áudio | Sinalização | Status |
|---------|-------|-------------|--------|
| Servidor → Celular | ✅ Bidirecional | ✅ OK | **Funciona 100%** |
| Celular → Servidor | ✅ Bidirecional | ✅ OK | **Funciona 100%** |
| Frontend (Browser) → Celular | ✅ Bidirecional | ✅ OK | **Funciona 100%** |
| Servidor → Servidor | ❌ Crash no decode | ⚠️ Ringtone persiste | **Não funciona** |

---

## 🔍 Diagnóstico Detalhado

### Problema 1 — Ringtone Persistente Após Atendimento

**Sintoma**: Quando o Servidor A liga para o Servidor B e o Servidor B atende a chamada, o celular do usuário B (que está vinculado ao mesmo número do WhatsApp) **continua tocando** como se a chamada não tivesse sido atendida. O Servidor A recebe corretamente o `CallAccept` e transiciona para o estado `active`, mas os outros dispositivos do Servidor B (celular, WhatsApp Web) não são notificados.

**Causa Raiz Identificada**: Na lógica atual do `HandleCallAccept` em [`callmanager_signaling.go:161-176`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/call/callmanager_signaling.go#L161-L176), quando o Servidor A recebe o accept do Servidor B, ele envia stanzas `accepted_elsewhere` para os **outros dispositivos do peer (B)** — ou seja, para os dispositivos do B que o A conhece via `RelayData.ParticipantJids`. Isso funciona corretamente quando o peer é um celular normal.

Porém, o problema é que o **próprio Servidor B** — ao aceitar a chamada — **não notifica seus próprios outros dispositivos** (celular, WhatsApp Web) de que ele já atendeu. O código do `AcceptCall` em [`callmanager.go:164-203`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/call/callmanager.go#L164-L203) envia o accept para o chamador mas não dispara terminações `accepted_elsewhere` para os dispositivos que compartilham o mesmo JID base.

**Por que funciona com celular**: Quando um celular atende uma chamada, o próprio WhatsApp nativo cuida de notificar os outros dispositivos vinculados. Quando é um servidor whatsmeow, essa responsabilidade é do código da aplicação.

**Fluxo atual (quebrado)**:
```
Servidor A liga → WhatsApp propaga para todos os dispositivos do B
Servidor B (VPS) atende → envia <accept> para A
Servidor A recebe accept → envia accepted_elsewhere para dispositivos de B
                          (MAS só para os que A conhece como peers)
Celular do B → NÃO recebe accepted_elsewhere → continua tocando ☎️
```

**Fluxo correto (proposto)**:
```
Servidor A liga → WhatsApp propaga para todos os dispositivos do B
Servidor B (VPS) atende → envia <accept> para A
                        → envia accepted_elsewhere para SEUS PRÓPRIOS outros dispositivos
Servidor A recebe accept → envia accepted_elsewhere (redundância positiva)
Celular do B → recebe accepted_elsewhere → para de tocar ✅
```

---

### Problema 2 — Crash no Decode de Áudio (SILK Resampler Assertion)

**Sintoma**: Quando o Servidor B atende e começa a enviar áudio de volta (a IA do B fala), o **Servidor A crasha** com a mensagem `assertion failed: 0` em `resampler.c` da biblioteca `libopus_mlow.so`. O crash é unilateral — somente o servidor que **iniciou** a chamada (A) crasha; o servidor receptor (B) continua operando normalmente.

**Observação crítica**: O encode MLow do servidor funciona perfeitamente — quando o servidor codifica PCM→MLow e envia para um celular, o celular ouve sem problemas. Da mesma forma, o decode MLow funciona quando o servidor recebe áudio de um celular. O problema é **exclusivamente** quando um servidor tenta decodificar bitstream MLow gerado por **outro servidor** usando a mesma `libopus_mlow.so`.

**Causa Raiz Provável**: A biblioteca `opus_mlow` é uma variante customizada do Opus criada pela Meta (WhatsApp) que inclui extensões SILK com resampling interno. O codec `mlowCodec` no AstraCalls é um objeto único que contém encoder **e** decoder na mesma instância.

Quando o Servidor A inicia uma chamada:
1. `StartCall()` → `initCodec()` → cria **um** `mlowCodec` (encoder + decoder)
2. O encoder começa a gerar pacotes de silêncio/keepalive via `startSilenceKeepaliveLocked()` com DTX (Discontinuous Transmission) habilitado (`ctlSetDTX = 1`)
3. Esses pacotes DTX podem alterar o estado interno da lib `opus_mlow`
4. Quando o Servidor B atende e começa a enviar áudio **real** (PCM da IA codificado), o bitstream tem um formato de bandwidth/mode diferente
5. O decoder do Servidor A, cujo estado interno pode estar contaminado pelo encoder DTX, tenta fazer resampling para uma taxa não suportada
6. A assertion fail no `resampler.c` causa abort do processo

**Por que funciona com celular**: O celular usa o encoder MLow **nativo** do WhatsApp, que gera um bitstream com parâmetros internos que o decoder da `libopus_mlow.so` reconhece corretamente. A diferença sutil entre o bitstream gerado pela lib compilada (do repositório `edgardmessias/opus_mlow`) e o bitstream nativo do celular é suficiente para causar o crash no resampler SILK quando o decoder está num estado específico.

**Tentativas anteriores (sem sucesso)**:
- Substituir o codec MLow por Opus genérico: resultado em **sem som** — o relay do WhatsApp aparentemente requer o formato MLow específico para transportar áudio
- Corrigir o sample rate para 16kHz na decodificação: corrigiu **parcialmente** o crash, mas não resolveu a incompatibilidade fundamental do bitstream entre servidores

---

## 🛠️ Plano de Implementação

O plano está dividido em **4 frentes** que devem ser implementadas em conjunto para resolver ambos os problemas de forma completa e resiliente.

---

### Frente 1 — Correção do Ringtone (`accepted_elsewhere` para próprios dispositivos)

**Objetivo**: Quando o servidor receptor aceita uma chamada, notificar seus próprios outros dispositivos (celular, WhatsApp Web) para pararem de tocar.

**Arquivo**: [`callmanager.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/call/callmanager.go) — método `AcceptCall()`

**Mudança**: Após enviar o `<accept>` para o chamador, adicionar uma goroutine que:
1. Lê a lista de participantes do relay (`call.RelayData.ParticipantJids`)
2. Identifica o JID base do nosso servidor (ex: `5561996878959@lid`)
3. Para cada participante que tem o mesmo JID base mas sufixo de dispositivo diferente (ex: `:0` quando nós somos `:71`), envia uma stanza `<terminate>` com motivo `"accepted_elsewhere"`
4. Cada envio é feito em goroutine separada com `context.Background()` para não bloquear

**Lógica detalhada**:
```
ourBase = CleanJID(ownCredJid())       // ex: "5561996878959@lid"
ourDevice = ensureDeviceJid(ownCredJid()) // ex: "5561996878959:71@lid"

Para cada participante em RelayData.ParticipantJids:
  Se CleanJID(participante) == ourBase:
    participanteDevice = ensureDeviceJid(participante)
    Se participanteDevice != ourDevice:
      → Enviar BuildTerminateStanza(participanteDevice, callID, creator, "accepted_elsewhere")
```

**Impacto**: Mudança isolada na sinalização. Não afeta o fluxo de áudio nem o estado da chamada. Baixo risco de regressão.

---

### Frente 2 — Decoders MLow Separados e Reset de Estado

**Objetivo**: Prevenir o crash no decoder MLow separando o estado do encoder e decoder, e permitindo resetar o decoder antes de receber áudio de um novo peer.

**Arquivos afetados**:
- [`codec.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/media/codec.go) — Interface `Codec`
- [`mlow_codec_real.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/media/mlow_codec_real.go) — Implementação real
- [`mlow_codec_stub.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/media/mlow_codec_stub.go) — Stub sem CGO
- [`callmanager_signaling.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/call/callmanager_signaling.go) — Chamada do reset
- [`callmanager_media.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/call/callmanager_media.go) — Proteção no decode

**Mudança 2.1 — Novo método `ResetDecoder()` na interface**:

Adicionar `ResetDecoder() error` à interface `Codec` em `codec.go`. Esse método destrói o decoder C atual e cria um novo com estado limpo, eliminando qualquer contaminação de estado do SILK resampler.

**Mudança 2.2 — Implementação do `ResetDecoder()` no `mlowCodec`**:

No `mlow_codec_real.go`, implementar o método que:
1. Chama `C.opus_decoder_destroy()` no decoder atual
2. Cria um novo decoder via `C.opus_decoder_create()` com os mesmos parâmetros (16kHz, mono)
3. Reconfigura o `ctlSetUsingSmpl = 1` no novo decoder
4. Retorna erro se a criação falhar

O mesmo é feito para o `opusGeneric` (Opus genérico sem SILK).

**Mudança 2.3 — Reset automático no `HandleCallAccept`**:

No `callmanager_signaling.go`, dentro do `HandleCallAccept` (quando o servidor que **ligou** recebe o accept do peer), resetar o decoder antes de iniciar o keepalive. Isso garante que o decoder está com estado limpo antes de começar a receber áudio real do peer:

```
HandleCallAccept:
  ... (transição para RemoteAccepted) ...
  Se codec != nil:
    codec.ResetDecoder()    // ← Estado limpo antes de receber áudio do peer
  ... (iniciar keepalive) ...
```

**Mudança 2.4 — Proteção `recover()` no decode**:

No `onRelayData()` em `callmanager_media.go`, envolver a chamada `codec.Decode()` com um `defer recover()` para capturar panics Go inesperados. Se ocorrer um panic, o sistema loga o erro e substitui o áudio por silêncio em vez de crashar.

> **⚠️ Limitação importante**: O `recover()` do Go **não captura** crashes nativos de C como `SIGABRT` (que é o que o `assertion failed: 0` do `resampler.c` causa). A verdadeira proteção é o reset do decoder (Mudança 2.3). O `recover()` é apenas uma camada extra para panics Go inesperados.

**Impacto**: Mudança na interface `Codec` — todos os implementadores precisam do novo método. A separação de estado é a medida mais importante para prevenir o crash.

---

### Frente 3 — Fallback com Decoder Opus Genérico

**Objetivo**: Se o decode MLow falhar repetidamente, usar um decoder Opus padrão (sem extensões SILK) como fallback para tentar decodificar os pacotes e manter algum áudio na chamada.

**Arquivos afetados**:
- [`callmanager.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/call/callmanager.go) — Novos campos
- [`callmanager_media.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/call/callmanager_media.go) — Lógica de fallback
- [`callmanager_relay.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/call/callmanager_relay.go) — Cleanup do fallback

**Mudança 3.1 — Novo campo `fallbackCodec` no `CallManager`**:

Adicionar ao struct:
```
fallbackCodec   media.Codec   // Decoder Opus genérico de fallback
decodeFailCount int           // Contador de falhas consecutivas no decode MLow
```

**Mudança 3.2 — Criação do fallback no `initCodec()`**:

Após criar o codec MLow principal, criar também um `NewOpusCodec(16000, 320)` como fallback. Esse codec usa a mesma `libopus_mlow.so` mas sem as flags SILK customizadas (`ctlSetUsingSmpl` não é setado), operando em modo Opus padrão.

**Mudança 3.3 — Lógica de fallback no `onRelayData()`**:

Quando o decode MLow falha:
1. Incrementar `decodeFailCount`
2. Se `decodeFailCount > 5` e `fallbackCodec` existe:
   - Tentar decodificar com o Opus genérico
   - Se funcionar, usar o resultado
   - Se não, descartar o pacote
3. Quando o decode (MLow ou fallback) funciona, resetar o contador

**Raciocínio**: O bitstream MLow é baseado em Opus, então um decoder Opus padrão **pode** conseguir decodificar a parte não-SILK do bitstream, gerando áudio degradado mas funcional. Isso é melhor do que silêncio total.

**Mudança 3.4 — Cleanup do fallback**:

No `cleanupMedia()` em `callmanager_relay.go`, fechar e limpar o `fallbackCodec` junto com o codec principal.

**Impacto**: Baixo risco. O fallback só é ativado após 5 falhas consecutivas do MLow, então não afeta o caminho normal.

---

### Frente 4 — Diagnóstico e Métricas RTP

**Objetivo**: Adicionar logging estruturado de métricas de áudio para facilitar o diagnóstico de problemas futuros sem precisar reproduzir o cenário de crash.

**Arquivos afetados**:
- [`callmanager.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/call/callmanager.go) — Contadores
- [`callmanager_media.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/call/callmanager_media.go) — Logging periódico

**Mudança 4.1 — Novos contadores no `CallManager`**:

```
rtpRecvCount    uint64   // Total de pacotes RTP recebidos
decodeOkCount   uint64   // Total de decodes bem-sucedidos
```

**Mudança 4.2 — Logging periódico a cada 100 pacotes**:

No `onRelayData()`, a cada 100 pacotes RTP processados, logar uma linha com:
- Total de pacotes recebidos
- Total de decodes OK vs falhas
- SSRC do peer
- Tamanho médio do payload (indicador do tipo de frame Opus)

Isso permite identificar rapidamente:
- Se os pacotes estão chegando (recvCount crescendo)
- Se o decode está falhando (failCount alto)
- Se o SSRC está correto (comparar com o esperado)
- Se o payload tem tamanho suspeito (frames DTX são muito pequenos, < 10 bytes)

**Impacto**: Nenhum impacto funcional. Apenas logging adicional no nível `Info` com frequência controlada (1 log a cada ~2 segundos de áudio).

---

## ⚠️ Restrições e Cuidados

### O que NÃO deve ser feito
* **Não substituir o codec MLow por Opus genérico globalmente**: Isso já foi tentado e resulta em sem som. O relay do WhatsApp requer o formato MLow para chamadas 1:1.
* **Não remover o `CleanJID` das stanzas `<call>` raiz**: A Meta rejeita stanzas com dispositivo no `"to"` principal (descoberta da sessão anterior).
* **Não confiar no `recover()` como proteção primária contra crashes CGO**: O `recover()` do Go não captura `SIGABRT` de C. A proteção real é o `ResetDecoder()`.
* **Não alterar os parâmetros do encoder MLow** (`Bitrate`, `Complexity`, `DTX`, `ctlSetUsingSmpl`): Esses parâmetros produzem bitstream compatível com celulares. Alterá-los pode quebrar chamadas servidor→celular que funcionam.
* **Não fazer commits ou git operations automáticas**: Restrição estrita do desenvolvedor humano.

### Riscos conhecidos
* **SIGABRT irrecuperável**: Se o `ResetDecoder()` não prevenir completamente o crash, o processo vai cair. Não há fallback possível para assertion fails em C. Nesse caso, seria necessário investigar a nível de biblioteca (compilar `libopus_mlow.so` com assertions desabilitadas ou com patches no `resampler.c`).
* **Fallback Opus genérico pode não decodificar MLow**: O bitstream MLow usa extensões proprietárias da Meta. Um decoder Opus padrão pode rejeitar o bitstream completamente em vez de decodificar parcialmente.

---

## 📋 Resumo de Arquivos Modificados

| Arquivo | Frente | Tipo de Mudança |
|---------|--------|-----------------|
| [`codec.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/media/codec.go) | F2 | + método `ResetDecoder()` na interface |
| [`mlow_codec_real.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/media/mlow_codec_real.go) | F2 | + implementação de `ResetDecoder()` em `mlowCodec` e `opusGeneric` |
| [`mlow_codec_stub.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/media/mlow_codec_stub.go) | F2 | + stub `ResetDecoder()` |
| [`callmanager.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/call/callmanager.go) | F3, F4 | + campos `fallbackCodec`, `decodeFailCount`, contadores RTP |
| [`callmanager_signaling.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/call/callmanager_signaling.go) | F1, F2 | + `accepted_elsewhere` no `AcceptCall`; + `ResetDecoder()` no `HandleCallAccept` |
| [`callmanager_media.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/call/callmanager_media.go) | F2, F3, F4 | + proteção recover; + fallback decoder; + métricas RTP |
| [`callmanager_relay.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/call/callmanager_relay.go) | F3 | + cleanup do `fallbackCodec` |

---

## ✅ Plano de Verificação

### Testes Automatizados
```bash
go test ./internal/voip/...       # Testes da pilha de mídia
cd client && npm run build        # Type-check + build de produção
```

### Testes Manuais (5 cenários obrigatórios)

| # | Cenário | O que verificar |
|---|---------|-----------------|
| 1 | **Servidor → Celular** | Áudio bidirecional + transcrição IA (regressão) |
| 2 | **Celular → Servidor** | Auto-atendimento + áudio IA (regressão) |
| 3 | **Servidor A → Servidor B** | Celular do B para de tocar ✅ / Servidor A não crasha ✅ / Áudio bidirecional ✅ / Métricas RTP nos logs ✅ |
| 4 | **Frontend (Browser) → Servidor** | Áudio bidirecional via WebRTC (regressão) |
| 5 | **Chamada manual (sem IA)** | Áudio do operador humano funciona (regressão) |

### Logs a observar no Servidor A durante teste #3
```
[INFO] offer ack received          relays=2 participants=4
[INFO] remote accepted call        relay_connected=true
[INFO] RTP stats                   received=100 decode_ok=98 decode_fail=2 ssrc=0xABCDEF payload_len=42
[INFO] relay connected → active    call_id=...
```

Se `decode_fail` for muito alto ou `received` não crescer, há problema no relay/SRTP.
Se `decode_ok` crescer mas não houver áudio, o problema está no pipeline acima do decoder (pacing, Gemini, etc).
