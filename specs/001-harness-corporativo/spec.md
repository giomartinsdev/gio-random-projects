# Feature Specification: Harness Corporativo — Sessões de Handoff de Implementação

**Feature Branch**: `001-harness-corporativo`

**Created**: 2026-09-11

**Status**: Draft

**Input**: User description: "harness corporativo: pessoas iniciam sessões e compartilham / continuam implementações / estendem — MVP e vamos pra cima"

## Resumo

Um web app interno onde o time inicia **sessões de implementação** (objetivo + contexto), e qualquer pessoa do time pode **acompanhar**, **retomar** (assumir a sessão e continuar a implementação) ou **estender** (ramificar herdando o contexto). O valor central é o *handoff*: dev A precisa parar no meio de uma implementação; dev B retoma sem precisar perguntar nada ao A — todo o contexto está na sessão.

Decisões de produto já fechadas com o dono (2026-09-11):

- **Sessão = handoff de implementação** (entidade estruturada própria: objetivo, contexto, próximos passos, timeline) — não acoplada a nenhuma ferramenta de IA; transcrições de agente podem vir depois.
- **Entrega**: deploy no VPS atrás do Cloudflare Access (mesmo caminho dos apps existentes: `modules/apps/`, pipelines CI/CD, Terraform de DNS/Access/container).
- **Stack**: Go API + React/Vite, SQLite no volume do container.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Dev inicia uma sessão de implementação (Priority: P1)

Dev A está começando uma implementação (ex.: "trocar JWT do bet-api por sessões"). Ele cria uma **sessão** com título, objetivo, repo/branch alvo e o contexto inicial (links, decisões já tomadas, gotchas, próximos passos). A sessão nasce com ele como dono atual e status "em andamento", visível para todo o time.

**Why this priority**: Sem sessão não existe harness. É o primeiro passo de todos os outros cenários.

**Independent Test**: Criar uma sessão preenchendo objetivo + contexto e vê-la na lista do time com autor, status e dono corretos.

**Acceptance Scenarios**:

1. **Given** dev autenticado no harness, **When** preenche título, objetivo e contexto e salva, **Then** a sessão é criada com status "em andamento", ele como dono atual, com timestamp de criação, e aparece na lista de sessões do time.
2. **Given** dev autenticado, **When** tenta criar sessão sem título ou sem objetivo, **Then** o sistema recusa e pede os campos obrigatórios.

### User Story 2 — Dev retoma a sessão de outra pessoa (Priority: P1)

Dev B abre uma sessão ativa de dev A, lê o contexto e a timeline, clica **"Retomar"**. A partir dali ele passa a ser o dono atual, a retomada fica registrada na timeline, e ele atualiza o contexto/próximos passos conforme trabalha (inclusive anexando commits). Quando A voltar, lê o que B fez e pode retomar de volta — a baton passa de mão em mão pelo app, não por call de voz.

**Why this priority**: O handoff é o produto. Sem retomada, o app é só um bloco de notas.

**Independent Test**: Dev B retoma uma sessão de dev A; a timeline registra a retomada, o dono atual muda para B, e o contexto editado por B persiste.

**Acceptance Scenarios**:

1. **Given** sessão ativa com dono atual A, **When** dev B clica "Retomar" e confirma, **Then** o dono atual passa a ser B, um evento de retomada entra na timeline com autor e timestamp, e o campo "próximos passos" permanece editável por B.
2. **Given** sessão ativa, **When** o dono atual edita o contexto/próximos passos e salva, **Then** a edição persiste e um evento "contexto atualizado" entra na timeline (sem versionar cada tecla — última escrita vence).
3. **Given** dois devs clicam "Retomar" quase ao mesmo tempo, **When** o segundo confirma, **Then** a última retomada confirmada vence e a timeline mostra as duas tentativas em ordem (não há lock exclusivo no MVP).

### User Story 3 — O time acompanha as sessões (Priority: P2)

Qualquer pessoa autenticada (Cloudflare Access) vê a lista de sessões — ativas primeiro — com título, repo, status, dono atual e última atualização; abre a página da sessão e lê objetivo, contexto, próximos passos e timeline completa. "Compartilhar" no MVP é essa visibilidade por padrão para o time logado (sem permissão por sessão, sem link público).

**Why this priority**: É o que torna o handoff descobrível — B precisa achar a sessão de A sem ser convidado.

**Independent Test**: Dev C (que não criou nada) lista as sessões, abre uma de dev A e lê contexto + timeline sem precisar de convite.

**Acceptance Scenarios**:

1. **Given** dev autenticado que nunca criou sessão, **When** abre a lista, **Then** vê todas as sessões do time com status, dono atual e última atualização, ordenadas por atividade recente com ativas em destaque.
2. **Given** sessão existente, **When** dev filtra a lista por status ou por dono atual, **Then** só as sessões correspondentes aparecem.
3. **Given** pessoa autenticada que não é dona, **When** abre a página de uma sessão, **Then** consegue ler tudo (objetivo, contexto, timeline) — leitura nunca é bloqueada para o time.

### User Story 4 — Dev estende uma sessão (ramificação) (Priority: P2)

A partir de uma sessão existente, dev C cria uma **extensão**: uma nova sessão que herda o contexto da origem (cópia inicial) e fica linkada a ela. A origem continua seu fluxo; a extensão evolui independente (ex.: "cobrir o runner também" a partir de "refatorar auth da API"). A página da sessão mostra de onde ela veio e suas extensões.

**Why this priority**: Permite explorar caminhos sem sequestrar a sessão original — segundo maior ganho de valor, e pode vir logo após o handoff básico.

**Independent Test**: A partir da sessão S, criar extensão E; E herda o contexto de S, aparece como extensão de S, e editá-la não altera S.

**Acceptance Scenarios**:

1. **Given** sessão S com contexto preenchido, **When** dev clica "Estender" e dá título/objetivo à extensão, **Then** nasce uma sessão nova com status "em andamento", ele como dono, contexto inicial copiado de S, e link de origem para S.
2. **Given** extensão E criada de S, **When** B edita o contexto de E, **Then** o contexto de S permanece intacto.
3. **Given** sessão S com 2 extensões, **When** alguém abre S, **Then** as extensões aparecem listadas (título, dono atual, status).

### User Story 5 — Sessão é entregue ou arquivada (Priority: P3)

Quando a implementação é mergeada/entregue, o dono atual marca a sessão como **entregue** (com referência ao PR/merge). Sessões que viraram poeira podem ser **arquivadas**. Ambas saem do destaque de ativas, continuam legíveis e pesquisáveis, e podem ser reabertas.

**Why this priority**: Fecha o ciclo de vida, mas o time já ganha valor com P1/P2 sozinhos.

**Independent Test**: Marcar uma sessão como entregue com link de PR; ela sai das ativas, fica com selo de entregue, e volta a ser ativa se reaberta.

**Acceptance Scenarios**:

1. **Given** sessão ativa, **When** o dono atual marca como entregue informando link de PR (opcional), **Then** status vira "entregue", evento entra na timeline, e a sessão sai do destaque de ativas na lista.
2. **Given** sessão entregue ou ativa, **When** alguém arquiva, **Then** status vira "arquivada" e ela continua consultável via filtro.
3. **Given** sessão entregue/arquivada, **When** qualquer dev reabre, **Then** status volta a "em andamento" e o evento entra na timeline.

### Edge Cases

- Dois devs editam o contexto simultaneamente: última escrita vence; o form mostra o conteúdo que ele viu ao abrir e avisa que o conteúdo mudou desde a abertura antes de sobrescrever (MVP: aviso, sem merge).
- Sessão sem dono "ativo" (dono sumiu/virou fantasma): qualquer dev pode retomar diretamente — não existe bloqueio de permissão, só a timeline diz quem está com a baton.
- Contexto muito grande: limite máximo por sessão (ordem de dezenas de KB), recusado com mensagem clara.
- Markdown injeção/XSS no contexto: renderizado como markdown sanitizado; texto puro nunca vira HTML cru.
- Título/repo inexistentes ou digitados errado: sem validação contra serviços externos no MVP — campo de texto livre.
- API indisponível: frontend mostra estado de erro e mantém o rascunho do form localmente (localStorage) para não perder o que foi digitado.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST exigir autenticação para qualquer acesso; a identidade vem do Cloudflare Access (SSO do time) e o app não faz login próprio.
- **FR-002**: O sistema MUST exibir o nome/e-mail da pessoa autenticada e usar essa identidade como autor de ações (criação, retomada, edição, entrega).
- **FR-003**: O sistema MUST permitir criar sessão com: título (obrigatório), objetivo (obrigatório), repo/branch alvo (opcional), contexto inicial em markdown (opcional, pode completar depois).
- **FR-004**: O sistema MUST manter, por sessão: status (`em_andamento`, `entregue`, `arquivada`), criador, **dono atual**, timestamps de criação e última atualização.
- **FR-005**: O sistema MUST permitir que qualquer dev autenticado **retome** uma sessão: o dono atual passa a ser ele e um evento de retomada é registrado na timeline.
- **FR-006**: O sistema MUST permitir que o dono atual (e no MVP, qualquer dev autenticado — permissão branda) edite contexto e próximos passos, registrando um evento de atualização na timeline.
- **FR-007**: O sistema MUST registrar na timeline de cada sessão, com autor e timestamp: criação, retomada, atualização de contexto, extensão criada, mudança de status (entregue/arquivada/reaberta).
- **FR-008**: O sistema MUST permitir **estender** uma sessão: nova sessão filha que copia o contexto da origem e mantém link bidirecional (origem ↔ extensões).
- **FR-009**: O sistema MUST listar todas as sessões visíveis ao time, com filtro por status e por dono atual, ordenadas por última atividade com ativas em destaque.
- **FR-010**: O sistema MUST permitir mudar status: entregue (com link de PR opcional), arquivada, reaberta — cada mudança vira evento na timeline.
- **FR-011**: O sistema MUST renderizar o contexto como markdown sanitizado (sem XSS).
- **FR-012**: O sistema MUST registrar quem está "com a baton" (dono atual) de forma visível em toda a UI de sessão.
- **FR-013**: O sistema MUST limitar o tamanho do contexto por sessão e recusar acima do limite com mensagem clara.
- **FR-014**: O frontend MUST funcionar responsivo em desktop e mobile (o time consulta sessões no celular).

### Key Entities *(include if feature involves data)*

- **Sessão**: título, objetivo, repo/branch (opcional), contexto (markdown), próximos passos (markdown), status, criador, dono atual, link de PR (opcional, quando entregue), sessão de origem (quando extensão), timestamps.
- **Evento de timeline**: sessão (FK), tipo (`criacao`, `retomada`, `atualizacao_contexto`, `extensao_criada`, `status_mudou`), autor, payload resumido (ex.: novo status, link de PR), timestamp.
- **Usuário**: identidade derivada do Access (e-mail + nome) — não há tabela de cadastro no MVP; o app confia no JWT do Access.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Dev consegue criar uma sessão com objetivo + contexto em menos de 1 minuto.
- **SC-002**: Um dev que nunca viu a implementação consegue retomá-la usando apenas o que está na sessão (contexto + próximos passos + timeline), sem precisar perguntar nada ao autor — validado em teste de handoff real entre 2 pessoas.
- **SC-003**: Todo o time vê a lista de sessões em até 2 cliques a partir do login SSO.
- **SC-004**: 100% das ações (criar/retomar/editar/entregar) ficam rastreáveis na timeline com autor e timestamp.

## Assumptions

- O time é pequeno e confiável (acesso atrás do Cloudflare Access do time); permissões por sessão (privadas, por grupo) ficam fora do MVP.
- Não há notificações (Slack/e-mail) no MVP — a timeline in-app é a fonte de verdade; notificação entra numa fase seguinte.
- A identidade do Cloudflare Access é confiável (JWT validado pela API); não há papéis/perfis além de "autenticado" no MVP.
- SQLite atende o volume de um time interno (dezenas de usuários, centenas de sessões) — migração para Postgres só se necessário depois.
- Busca textual completa fica fora do MVP (filtro por status/dono cobre o essencial).
- O harness não executa código nem integra com Git no MVP — registrar commits/PR é texto digitado ou link colado.

## Dependências / Integrações (específico deste repo)

- Seguir o padrão de apps existentes: `modules/apps/harness-api/` (Go) e `modules/apps/harness-frontend/` (React/Vite), registrado nos pipelines CI/CD (`ALLOWED_APPS`) e no Terraform (DNS `harness.giomartins.dev`, Access app + policy, container no VPS com volume para o SQLite).
- Autenticação reutiliza o modelo Access já usado pelos apps (validação de JWT / hop SSO conforme padrão existente — detalhado em `research.md`).