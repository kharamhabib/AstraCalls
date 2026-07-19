// Prompts padrão das ferramentas predefinidas da IA. Fonte única usada pelo
// agente client-side (lib/ai/agent.ts) e pelo dialog de configuração (AIDialog) —
// antes eram duplicados e divergiam (inclusive com typos).
export const DEFAULT_TOOL_PROMPTS: Record<string, string> = {
  hangup:
    "* Ferramenta hangup (Desligar Chamada): Quando a conversa estiver resolvida, o cliente se despedir e não houver mais nenhuma pendência, agradeça pelo contato, despeça-se educadamente e chame a ferramenta hangup para desligar a ligação. Nunca deixe a ligação em silêncio ou pendente após a despedida.",
  open_ticket:
    "* Ferramenta open_ticket (Abrir Chamado): Use esta ferramenta quando o cliente solicitar falar com um atendente humano, suporte ou precisar de ajuda especializada que a IA não consiga resolver. Pergunte brevemente o motivo do chamado, informe ao cliente que o chamado foi registrado/aberto e pergunte educadamente se há mais alguma coisa em que você possa ajudar. Não desligue a chamada após usar esta ferramenta — apenas aguarde a resposta do cliente e use a ferramenta hangup para finalizar quando ele não precisar de mais nada.",
  send_message:
    '* Ferramenta send_message (Enviar WhatsApp): Use esta ferramenta quando o cliente solicitar que você envie informações por escrito, como um código de barras, chave Pix, link de confirmação, ou endereço. Diga ao cliente: "Estou te enviando esses dados agora mesmo no seu WhatsApp" e execute a ferramenta.',
  schedule_call:
    '* Ferramenta schedule_call (Reagendar/Agendar Ligação): Se o cliente disser que não pode falar no momento, pedir para retornar mais tarde, ou solicitar um lembrete (ex: "me ligue e confirme a reunião às 10 da manhã"), pergunte educadamente pela data e hora desejada. Calcule a data/hora exata relativa ao horário atual ([today]) e execute esta ferramenta preenchendo o parâmetro \'datetime\' em formato ISO e \'prompt\' com o roteiro ou lembrete (ex: "Confirmar reunião"). Confirme para o cliente o agendamento antes de desligar.',
};

export const FETCH_CHATWOOT_HISTORY_PROMPT =
  "* Ferramenta fetch_chatwoot_history (Buscar histórico do Chatwoot): Use esta ferramenta para carregar o histórico recente de conversas por texto do cliente caso ele faça perguntas sobre o que foi falado no chat de texto anteriormente, ou se você precisar recuperar o contexto de interações passadas. Chame esta ferramenta se o cliente perguntar se você se lembra dele, se tem acesso ao chat, ou se pedir para retomar a conversa anterior.";

export const TOOL_RULES_HEADER =
  "\n\n### REGRAS PARA O USO DE FERRAMENTAS (APIS):\n* Se a ferramenta exigir argumentos (como a mensagem de texto ou número no send_message), extraia-os naturalmente da fala do usuário ou use os valores padrões fornecidos, sem soletrar os parâmetros tecnicamente para o cliente.\n";
