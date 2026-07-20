# Próximas Implementações e Roadmap: Kallia

Este documento registra as implementações recentes concluídas e as melhorias futuras planejadas para a evolução da plataforma **Kallia**.

---

## 🎯 Concluído Recentemente (Milestone Rebranding & SaaS)

- [x] **Autenticação JWT & Perfis (RBAC)**: Login por e-mail/senha com papéis `appadmin`, `admin` e `normal`.
- [x] **Projetos & Billing (Planos de Cobrança)**: Tabela de projetos com planos `basic`, `advantage` e `expert`, controle de vigência e limitação dinâmica de conexões.
- [x] **API Keys por Conexão (`kc_*`)**: Geração automática de chaves únicas por sessão para consumo seguro por APIs externas.
- [x] **Agentes Especialistas & Hot-Swap (`TransferTo`)**: Suporte a personas distintas para chamadas *inbound* e *outbound*, e transferência de chamadas em tempo real entre agentes sem derrubar o canal VoIP.
- [x] **Rebranding Completo para Kallia**: Módulo Go, imports, docker-compose, Dockerfile, scripts PowerShell/BAT e variáveis de ambiente `KALLIA_*` com fallback gracioso para instalações legadas.
- [x] **Exclusão Autenticada no Histórico**: Correção e injeção do Bearer Token no frontend para exclusão segura de registros.

---

## 🚀 Próximas Implementações (Roadmap)

1. **Painel SaaS Admin Super-App (`appadmin`)**:
   - Interface web para visualizar todos os projetos cadastrados, métricas de consumo de minutos de chamada por projeto, gerenciar status de assinaturas e alterar planos em tempo real.

2. **Relatórios Avançados de Performance de Agentes**:
   - Métricas de NPS acumulado por agente especialista.
   - Análise de sentimentos e tempo médio de atendimento (TMA) das ligações operadas por IA.

3. **Integração de Provedores de Voz Adicionais**:
   - Opção de fallback para ElevenLabs / OpenAI Realtime API além do Google Gemini Live.

4. **Gravação Dual-Channel na Nuvem (S3 / R2)**:
   - Exportação automática dos arquivos WAV de gravação de áudio para buckets S3 ou Cloudflare R2 para economizar espaço de disco no VPS.
