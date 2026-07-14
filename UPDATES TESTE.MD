# Handoff e Status de Atualização: Ligação de Servidor para Servidor (VoIP)

## 📌 Contexto Geral

Estamos trabalhando na resolução de chamadas VoIP de **Servidor para Servidor** (whatsmeow ↔ whatsmeow).
Em ligações de Servidor para Celular, tudo funciona 100%. No entanto, de Servidor para Servidor, a chamada no Servidor A (iniciador) ficava presa tocando ("ringing"), enquanto o Servidor B (VPS, que atende) aceitava a chamada e iniciava a conversação da IA.

---

## 🛠️ O que foi feito nesta sessão

1. **Correção de Crash de Taxa de Amostragem (Sample Rate)**:
   - Resolvido o crash do samplerate da biblioteca `opus_mlow` para 16kHz na decodificação de entrada.
2. **Roteamento Preciso de JIDs nas Stanzas (CleanJID na Tag Raiz `<call to="...">`)**:
   - Descobrimos que o WhatsApp rejeita silenciosamente **qualquer** stanza (seja `accept`, `preaccept`, `mute_v2`, `terminate` ou `reject`) se a tag raiz `<call to="...">` contiver um sufixo de dispositivo (como `:71` ou `:2`). Por isso, todas elas devem usar obrigatoriamente `CleanJID` no atributo `to` raiz.
   - O direcionamento ponto-a-ponto do `accept` para o companion específico do chamador (ex: `:71`) é feito exclusivamente através da tag interna `<to jid="...:71@lid">` contendo a criptografia Signal diretamente dentro da tag `<accept>`.
   - Quando o `accept` chega no chamador, a Meta coloca o JID do dispositivo que aceitou a chamada no atributo `from` do nó `<call>` raiz recebido (ex: `...:2@lid`). Isso permite ao chamador identificar exatamente qual companion atendeu e enviar com sucesso a stanza `accepted_elsewhere` para fazer o celular primário `:0` parar de tocar.
3. **Criptografia Signal Direta do Accept (Sem `<destination>`)**:
   - O `BuildAcceptStanza` mantém os elementos `<to jid="...">` gerados sob `<accept>` de forma direta (removendo o wrapper obsoleto `<destination>`). A criptografia é gerada exclusivamente para o JID do `callCreator` (o dispositivo que iniciou a chamada).

---

## 🚀 Próximos Passos (Para a próxima sessão)

1. **Deploy da Versão Atual na VPS**:
   - Fazer `git commit` e `git push` do estado atual do repositório.
   - Rodar o deploy da imagem na VPS pelo Coolify.
2. **Testar Chamada**:
   - Ligar de Servidor A (Local) para Servidor B (VPS).
   - Verificar nos logs se a stanza `<accept>` chega no websocket de quem ligou e se o diálogo no frontend React muda de "Chamando..." para "Em chamada".
3. **Se ainda assim o `accept` não for recebido**:
   - Inspecionar a assinatura e o retorno de `CreateParticipantNodes` na VPS para certificar que ela está gerando o nó de criptografia correto para o dispositivo secundário `:71` do Servidor A.
   - Verificar se hay alguma outra stanza de sinalização sendo enviada com JID com dispositivo na raiz que possa estar quebrando a transição de estado da chamada.

---

## ⚠️ O que NÃO deve ser feito (Restrições)

- **Não recolocar a tag `<destination>` no accept**: Confirmamos que o accept VoIP 1-para-1 é direto e não a utiliza.
- **Não remover o `CleanJID` das stanzas `<call>` raiz**: A Meta rejeita as stanzas estruturalmente se elas forem enviadas com dispositivo no `"to"` principal.
- **Não usar IDs de dispositivo fixos no código**: A Meta gera IDs reativos altos para LIDs pareados via QR Code (como `:71` ou `:99`). O código deve tratá-los de forma dinâmica.
