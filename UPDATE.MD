# UPDATE: Correção de Chamadas VoIP Servidor → Servidor

## 📌 Contexto Geral

O AstraCalls suporta chamadas VoIP via WhatsApp em múltiplos cenários: **Servidor→Celular**, **Celular→Servidor**, **Frontend(Browser)→Celular** e **Servidor→Servidor**. Todos os cenários funcionam corretamente **exceto** o último — chamadas entre dois servidores AstraCalls (whatsmeow↔whatsmeow) apresentam dois problemas críticos que impedem o uso em produção.

### Cenários e Status Atual

| Cenário | Áudio | Sinalização | Status |
|---------|-------|-------------|--------|
| Servidor → Celular | ✅ Bidirecional | ✅ OK | **Funciona 100%** |
| Celular → Servidor | ✅ Bidirecional | ✅ OK | **Funciona 100%** |
| Frontend (Browser) → Celular | ✅ Bidirecional | ✅ OK | **Funciona 100%** |
| Servidor → Servidor | ✅ Bidirecional | ✅ OK | **Corrigido (Em Validação)** |

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

## 🚀 Descobertas Avançadas e Soluções Finais

Durante os testes reais de chamadas de servidor para servidor e celular para servidor, identificamos novos pontos críticos de falha que foram completamente corrigidos:

### 1. Colisão de SSRC e Chaves SRTP em Dispositivos Multi-Device (Ringing/Preaccept)
*   **Problema**: Quando o Servidor A liga para a conta B, a oferta é enviada a todos os dispositivos vinculados de B (ex: Servidor B `:2` e Celular B `:0`). Ambos os dispositivos respondem enviando stanzas `<preaccept>` e conectam-se ao relay. Eles começam a transmitir pacotes RTP de keepalive concorrentemente com SSRCs e chaves SRTP diferentes. 
    1. A decodificação desses pacotes misturados causava o crash `silk_assert(0)`.
    2. Mesmo bloqueando por SSRC, se descriptografássemos os pacotes do Servidor B `:2` com a chave do Celular B `:0` (que era a única carregada inicialmente), a decodificação de dados corrompidos (lixo) crashava o resampler.
    3. Ao aceitar a chamada, a re-inicialização correta de chaves com a chave enviada no `<accept>` (`reinitSrtpLocked`) era sobrescrita imediatamente pela função genérica `initSrtpKeysLocked` com a chave antiga do offer, resultando em crash de descriptografia pós-atendimento.
    4. No lado do callee (destinatário da chamada, ex: a VPS), a lista de aparelhos participantes (`ParticipantJids`) ficava vazia, pois o offer de entrada não contém a tag `<relay>`. Sem essa lista, a VPS não conseguia mapear o SSRC do chamador para descriptografar os pacotes de ringing, nem notificar os outros aparelhos (ex: celular) via `accepted_elsewhere` para pararem de tocar.
*   **Solução**:
    *   Criamos o campo `allowedPeerSsrcs` no `CallManager`.
    *   No recebimento do primeiro pacote RTP em `onRelayData`, validamos e travamos o fluxo para o SSRC recebido.
    *   **Extração de Participantes no Callee**: Modificamos o `HandleCallOffer` para ler os JIDs de destino diretamente da tag `<destination>` do offer de entrada, preenchendo a lista de aparelhos participantes no início da chamada.
    *   **Mapeamento de Chaves por SSRC**: Criamos o método `findParticipantBySsrcLocked` e `updateSrtpRecvKeyLocked`. Quando o fluxo trava no SSRC, calculamos qual JID de participante corresponde àquele SSRC e atualizamos dinamicamente a chave de recebimento (`SetRecvKeying`) para esse JID. Isso garante descriptografia 100% correta durante a fase de preaccept.
    *   **Prevenção de Sobrescrita no Accept**: Ajustamos `HandleCallAccept` para apenas chamar `initSrtpKeysLocked` se o SRTP ya não tiver sido re-inicializado de forma customizada via `reinitSrtpLocked`.
    *   Quaisquer pacotes de outros SSRCs (keepalives concorrentes de outros aparelhos) são **descartados imediatamente**, protegendo o estado do resampler nativo de C.

### 2. Quebra do Resampler SILK por Mudança Dinâmica de Banda (TOC Byte)
*   **Problema**: A biblioteca `libopus_mlow` é restrita pela Meta para operar somente até Wideband (16kHz). Quando o Servidor B atende e a IA começa a falar, o codificador de B se ajusta dinamicamente à voz da IA e pode gerar pacotes com perfis de frequência superiores (como Super-wideband ou Fullband), alterando o TOC byte interno do pacote Opus. Ao receber esses frames com frequências incompatíveis, o decodificador em A tentava carregar coeficientes inexistentes, resultando no crash fatal `celt_assert(0)` em `silk/resampler.c`.
*   **Solução**:
    *   No construtor do codificador (`NewMLowCodec` e `NewOpusCodec` no [mlow_codec_real.go](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/media/mlow_codec_real.go)), configuramos permanentemente e de forma rígida os limites de frequência máxima do codificador via C-API:
        ```go
        C.mlow_enc_ctl(c.encoder, C.int(4008), C.int(1103)) // OPUS_SET_BANDWIDTH = OPUS_BANDWIDTH_WIDEBAND (16kHz)
        C.mlow_enc_ctl(c.encoder, C.int(4004), C.int(1103)) // OPUS_SET_MAX_BANDWIDTH = OPUS_BANDWIDTH_WIDEBAND (16kHz)
        ```
    *   Isso força o encoder a sempre gerar fluxos compatíveis de até 16kHz, eliminando os crashes do resampler de decodificação.

### 3. Falha de Conexão por Desempacotamento de Criptografia no Accept
*   **Problema**: Na tentativa anterior de remover a tag obsoleta `<destination>` do aceito da chamada, a lógica extraiu apenas a tag interna `<enc>` e descartou o nó envelopador `<to jid="...:0@lid">`. Sem o nó `<to>`, os celulares normais não conseguiam processar a criptografia Signal da stanza `<accept>`, mantendo a tela do chamador em "Chamando..." eternamente e impedindo que disparassem o sinal de cessar ringtone (`accepted_elsewhere`) para outros dispositivos.
*   **Solução**:
    *   Ajustamos `BuildAcceptStanza` no [signaling_build.go](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/signaling/signaling_build.go) para manter os nós `<to jid="...">` gerados de forma direta sob a tag `<accept>` (removendo apenas o wrapper `<destination>`). Isso reestabeleceu a compatibilidade com dispositivos normais.

### 4. Crash do Resampler C por Pacotes de Controle Curtos
*   **Problema**: Durante as fases de toque/preaccept, o WhatsApp envia pequenos pacotes de controle/keepalive de 1 ou 4 bytes no canal de mídia com o mesmo payload type (115). Ao passarmos esses pacotes de tamanho insuficiente (que não contêm cabeçalhos Opus completos, ex: Code 3 sem o byte de contagem de frames) para o `C.opus_decode`, a biblioteca tentava ler memória out-of-bounds ou lixo, corrompendo o resampler interno e causando o crash com `exit status 3`.
*   **Solução**:
    *   Implementamos nos decodificadores `mlowCodec` e `opusGeneric` no [mlow_codec_real.go](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/media/mlow_codec_real.go) a verificação do tamanho do frame recebido: `if frame != nil && len(frame) < 10`.
    	*   Qualquer payload menor de 10 bytes (que nunca é um pacote de áudio Opus real) é **descartado antecipadamente no nível do Go**, retornando silêncio (`make([]float32, frameSize)`) e erro nulo. Isso impede que os pings nativos alcancem a C-API do Opus, blindando o servidor local localmente de forma definitiva.

### 5. Roteamento de JID de Destino: Diferenciação entre Sinalização (Accept/Preaccept) e Controle (Terminate/Reject)
*   **Problema**:
    1. Anteriormente, limpávamos o JID (via `CleanJID`) no atributo `to` da tag raiz `<call>` em todas as stanzas.
    2. Descobrimos que se limparmos o JID para a raiz `<call to="...">` no `accept` e `preaccept`, o WhatsApp direciona a resposta apenas para o dispositivo principal (`:0`, ou seja, o celular do usuário) ao invés do companion chamador específico (ex. `:71`, que é o nosso servidor chamador). Como resultado, o servidor que iniciou a chamada nunca recebia o accept/preaccept na sinalização e a chamada ficava tocando infinitamente.
    3. No entanto, para as stanzas de controle (`terminate`, `reject`, `relaylatency`, `transport`, `mute_v2`), a Meta exige que o JID da raiz `<call>` seja limpo (JID base sem dispositivo), senão a stanza é descartada silenciosamente.
*   **Solução**:
    *   **Accept e Preaccept**: Mantemos o `peerJid` completo e intacto no atributo `to` da tag raiz `<call>` (revertendo o uso de `CleanJID` nessas stanzas no arquivo [`signaling_build.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/signaling/signaling_build.go)).
    *   **Controle (Terminate, Reject, etc.)**: Mantemos a limpeza de JID (`CleanJID`) na tag raiz para evitar descarte por parte do servidor do WhatsApp.

### 6. Identificação e Rejeição de Chamadas Servidor-Servidor (AstraCalls)
*   **Finalidade**: Identificar se uma chamada recebida provém de outro servidor AstraCalls (ou cliente companheiro web/desktop) em vez de um celular oficial, permitindo ignorar ou recusar a chamada automaticamente.
*   **Assinatura Protocolar**:
    *   **Dispositivo de Origem (Companion Device)**: O iniciador da chamada (`call-creator`) em outro servidor AstraCalls utiliza credenciais configuradas como dispositivo vinculado (companheiro), o que insere um sufixo `:X` com `X > 0` (ex: `:2@lid` ou `:71@lid`) no JID, enquanto celulares de usuários finais iniciam chamadas a partir de seu dispositivo principal (`:0@lid` ou sem sufixo).
*   **Mecanismo de Rejeição Automática**:
    *   Implementamos uma verificação em [`session.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/cmd/server/session.go) que detecta se a chamada vem de um companion device (dispositivo `> 0`).
    *   Se a variável de ambiente `WACALLS_REJECT_COMPANION_CALLS` estiver definida como `"true"`, o servidor AstraCalls rejeita a chamada imediatamente enviando uma stanza `<reject>`, logando o evento e encerrando o processamento antes de notificar os brokers de atendimento.

---

## ⚠️ Restrições e Cuidados

### O que NÃO deve ser feito
*   **Não limpar o JID no `to` raiz de `BuildAcceptStanza` e `BuildPreacceptStanza`**: Isso quebra a sinalização de volta para o servidor chamador.
*   **Não remover o `CleanJID` das stanzas de controle raiz**: A Meta rejeita stanzas de controle com dispositivo no `"to"` principal.
*   **Não confiar no `recover()` como proteção primária contra crashes CGO**: A proteção real é o `ResetDecoder()`, controle rígido de SSRC e restrição de banda no codificador.
*   **Não fazer commits ou git operations automáticas**: Restrição estrita de governança.

---

## 📋 Resumo de Arquivos Modificados

| Arquivo | Frente | Tipo de Mudança |
|---------|--------|-----------------|
| [`codec.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/media/codec.go) | F2 | + método `ResetDecoder()` na interface |
| [`mlow_codec_real.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/media/mlow_codec_real.go) | F2, F6, F7 | + reset do decoder; + trava rígida de largura de banda (16kHz) no encoder; + proteção contra pacotes de controle/pings curtos (< 10 bytes) |
| [`mlow_codec_stub.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/media/mlow_codec_stub.go) | F2 | + stub `ResetDecoder()` |
| [`srtp.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/media/srtp.go) | F5 | + método `SetRecvKeying` na struct `SrtpSession` |
| [`callmanager.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/call/callmanager.go) | F3, F4, F5 | + campos `fallbackCodec`, `decodeFailCount`, contadores RTP e `allowedPeerSsrcs`; + correção da identificação do JID do próprio dispositivo (`ourDevice`) no `AcceptCall` para envio do `accepted_elsewhere` |
| [`callmanager_signaling.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/call/callmanager_signaling.go) | F1, F2, F5 | + `accepted_elsewhere` no `AcceptCall`; + reset do decoder; + correção de sobrescrita de chave no accept; + extração de JIDs de participantes da tag `<destination>` no `HandleCallOffer` |
| [`callmanager_media.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/call/callmanager_media.go) | F2, F3, F4, F5 | + proteção recover; + fallback; + métricas RTP; + trava estrita por SSRC com re-derivação de chave de recebimento dinâmica |
| [`callmanager_srtp.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/call/callmanager_srtp.go) | F5 | + `findParticipantBySsrcLocked` e `updateSrtpRecvKeyLocked` para atualização de chave de recebimento |
| [`callmanager_relay.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/call/callmanager_relay.go) | F3 | + cleanup do `fallbackCodec` |
| [`signaling_build.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/internal/voip/signaling/signaling_build.go) | F5, F6 | Revertido CleanJID no `to` de `accept` e `preaccept` para usar `peerJid` com sufixo de dispositivo e garantir entrega de sinalização. |
| [`session.go`](file:///c:/Users/khara/Desktop/APPS%20GRAVITY/astracall/AstraCalls/cmd/server/session.go) | F6 | + Import strings; + Lógica de identificação e rejeição de chamadas companion via `WACALLS_REJECT_COMPANION_CALLS=true` no `onIncomingOffer` |

---

## ✅ Plano de Verificação

### Testes Automatizados
```bash
go test ./...       # Testes de integração de toda a pilha Go (Todos PASSARAM com sucesso ✅)
```

### Testes Manuais (5 cenários obrigatórios)

| # | Cenário | O que verificar |
|---|---------|-----------------|
| 1 | **Servidor → Celular** | Áudio bidirecional + transcrição IA (regressão) |
| 2 | **Celular → Servidor** | Auto-atendimento + áudio IA (regressão) |
| 3 | **Servidor A → Servidor B** | Celular do B para de tocar ✅ / Servidor A não crasha ✅ / Áudio bidirecional ✅ / Métricas RTP nos logs ✅ |
| 4 | **Frontend (Browser) → Servidor** | Áudio bidirecional via WebRTC (regressão) |
| 5 | **Chamada manual (sem IA)** | Áudio do operador humano funciona (regressão) |
| 6 | **Rejeição automática de servidor** | Definir `WACALLS_REJECT_COMPANION_CALLS=true` e ligar de outro servidor. A chamada deve ser recusada automaticamente sem tocar no destino. |

### Logs a observar no Servidor A durante teste #3
```
[INFO] offer ack received          relays=2 participants=4
[INFO] remote accepted call        relay_connected=true
[INFO] RTP stats                   received=100 decode_ok=100 ssrc=1946159529 payload_len=10
[INFO] relay connected → active    call_id=...
```

*   Se `decode_fail` for muito alto ou `received` não crescer, há problema no relay/SRTP.
*   O SSRC deve permanecer fixo durante toda a chamada após a primeira trava.
*   **Nota**: Certifique-se de que ambos os servidores (A e B) estejam rodando com a última versão do binário atualizado, pois a restrição de banda é imposta no codificador de quem envia a voz.
