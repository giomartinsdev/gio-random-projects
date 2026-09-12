# Quickstart — Validando o Harness Corporativo (specs/001-harness-corporativo)

Guia de validação ponta-a-ponta do MVP. Detalhes de implementação ficam em `tasks.md`; contratos em `contracts/api.md`; entidades em `data-model.md`.

## Pré-requisitos

- Go ≥ 1.25 e Node ≥ 20 (para rodar os dois apps localmente)
- Cloudflare Access configurado para o domínio do harness no deploy (validação de deploy) — para o **modo dev local**, a API roda com bypass de auth (env `HARNESS_DEV_BYPASS_AUTH=1` + `HARNESS_DEV_USER_EMAIL/NOME`), simulando o JWT do Access

## Rodando localmente (modo dev)

```bash
# terminal 1 — API (SQLite local, sem auth do Access)
cd modules/apps/harness-api
HARNESS_DEV_BYPASS_AUTH=1 HARNESS_DEV_USER_EMAIL=gio@corp HARNESS_DEV_USER_NOME=Gio HARNESS_DB_PATH=./harness.db go run .

# terminal 2 — frontend (Vite dev server com proxy para a API)
cd modules/apps/harness-frontend
npm install
npm run dev   # abre http://localhost:5173
```

Esperado: `GET http://localhost:8010/api/health` → `{"status":"ok"}`; o frontend carrega a lista vazia de sessões com o usuário `Gio` no topo.

## Testes

```bash
cd modules/apps/harness-api && go test ./...      # unit + handlers (httptest)
cd modules/apps/harness-frontend && npm run build  # typecheck + build da SPA
```

A suíte Go cobre: validações de sessão, transições de status, retomada (troca de dono + evento), 409 de edição concorrente e extensão (cópia de contexto + evento na origem) — mapeadas aos cenários abaixo.

## Cenários de validação (mapeados às user stories)

Execute em ordem com dois navegadores (ou janela normal + anônima, usuários `A` e `B` via env do bypass):

### 1. Iniciar sessão — US-1

1. Como `A`: `/sessoes/nova` → título "refatorar auth do bet-api", objetivo preenchido, contexto inicial com 2 decisões.
2. **Esperado**: redireciona à página da sessão; status "em andamento"; dono atual = A; timeline mostra `criacao`. Sessão aparece na lista do outro navegador (`B`) com dono = A.

### 2. Retomar sessão — US-2

1. Como `B`: abre a sessão de `A` → "Retomar".
2. **Esperado**: dono atual vira B; timeline registra `retomada` (A → B); B edita "próximos passos" e salva — evento `atualizacao_contexto` aparece.
3. Como `A`: recarrega a página — vê B como dono e a edição de B. **Este é o handoff: A retoma lendo só o que está na sessão (criterio SC-002).**

### 3. Conflito de edição — edge case

1. `A` e `B` abrem a mesma sessão; ambos editam o contexto sem recarregar; `A` salva primeiro, `B` salva depois.
2. **Esperado**: `B` recebe aviso "conteúdo mudou desde a abertura" com opção de sobrescrever (`409` → força). Sem `force`, nada é sobrescrito.

### 4. Estender — US-4

1. Como `B`: na sessão acima → "Estender" → título "cobrir o runner também".
2. **Esperado**: nova sessão com contexto **copiado** da origem, dono = B; na página da origem, a extensão aparece listada; editar a extensão não altera a origem.

### 5. Entregar e reabrir — US-5

1. Como `B`: "Entregar" com link de PR → status "entregue", sai do destaque de ativas na lista, evento `status_mudou` com `pr_link`.
2. "Arquivar" → consultável só via filtro. "Reabrir" → volta a `em_andamento`; timeline registra tudo.

### 6. Acesso e segurança — FR-001/FR-011

1. Sem o cookie/token do Access (deploy): qualquer rota `/api/*` responde `401`; frontend redireciona ao hop de login.
2. Colar `<script>alert(1)</script>` no contexto: a página renderiza como **texto**, sem executar.

## Validação de deploy (pós-implantação, fase de tasks)

1. PR do app → pipelines `go-ci-cd` e `ts-frontend-ci-cd` verdes (app registrado em `ALLOWED_APPS`).
2. Push em `main` → containers novos no VPS; `harness.giomartins.dev` responde atrás do Access (login SSO do time).
3. Refazer o cenário 1–2 no ambiente real com dois usuários do Access.