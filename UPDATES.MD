# Registros de Atualizações e Futuras Implementações — AstraCalls (RockCall)

## Concluído recentemente

### Redesign de Interface (Estilo PABX Wavoip Center)
- **Menu Lateral Fixo**: Navegação principal organizada em 4 seções:
  - 🟢 **Início** (`DashboardPage`): Métricas de chamadas do dia, perdidas, duração média, NPS Score e status do agente (Disponível, Ocupado, Em Pausa).
  - 📱 **Conexões** (`ConnectionsPage`): Gestão centralizada de sessões WhatsApp (escaneamento de QR Code, status e desconexão).
  - 📞 **Chamadas** (`CallsPage`): Webphone completo com discador numérico + Histórico com Player de Gravação.
  - ⚙️ **Ajustes** (`SettingsTab`): Configurações de IA Gemini Live, Prompts, Ferramentas, URA, Pesquisa NPS e Follow-up.
- **Webphone & Widget Flutuante**: Softphone com suporte a ligações manuais e com IA + `WebphoneDrawer` flutuante no rodapé de todas as páginas.

### Novas Funcionalidades PABX & IA via Servidor
1. **Gravação de Ligações no Servidor Go**:
   - `ServerAudioRecorder`: Mixagem em tempo real de áudio PCM/Opus do cliente e da IA/Operador em arquivo `.wav` (16kHz mono).
   - Servimento via API REST (`GET /api/sessions/{sid}/recordings/{callId}`) com player de áudio integrado no histórico.
2. **Engine de Pesquisa NPS Automatizada**:
   - Disparo automático de pesquisa por WhatsApp pós-chamada com delay configurável e filtro por duração mínima.
   - Captura de notas 0-10, salvamento no banco Postgres e envio de alerta via WhatsApp ao supervisor se a nota for detratora (<= 6).
   - Painel de métricas NPS no frontend (NPS Score, Promotores %, Neutros %, Detratores %).
3. **Follow-up para Ligações Não Atendidas**:
   - Motor background no Go para agendamento de mensagem textual via WhatsApp após chamadas perdidas/rejeitadas.
   - Cancelamento inteligente do envio se o cliente mandar mensagem ou ligar de volta antes do prazo expirar.

---

## Futuras Implementações Sugeridas (Backlog)

- [ ] **Transferência Cega de Chamadas entre Agentes Humanos**: Permitir encaminhar uma ligação ativa para o ramal ou número de outro operador.
- [ ] **Roteamento de Atendimento por URA Multi-Nível (IVR)**: URA de árvore interativa com menus numéricos e respostas por voz da IA.
- [ ] **Relatórios Exportáveis em PDF/CSV**: Exportação de métricas de chamadas e histórico de NPS para análise externa.
- [ ] **Suporte a Múltiplos Supervisores de NPS**: Lista de distribuição de números de supervisor para alertas de notas baixas.
