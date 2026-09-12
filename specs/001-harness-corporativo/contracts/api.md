# API Contract — harness-api (specs/001-harness-corporativo)

HTTP JSON API consumida pelo `harness-frontend`. Base: `/api`. Formato de datas: unix epoch seconds (inteiro). Markdown trafega como texto cru; sanitização acontece na renderização (frontend), nunca na resposta.

## Convenções

- Autenticação: toda rota `/api/*` exceto `GET /api/health` exige a sessão do Cloudflare Access (JWT — mecanismo exato em `research.md`); sem token válido → `401`.
- Erros: corpo único `{"erro": {"codigo": string, "mensagem": string}}` com códigos estáveis: `nao_autenticado`, `validacao`, `nao_encontrado`, `conflito`, `transicao_invalida`.
- Mutação que falha em validação retorna `422` (`validacao`) com `detalhes: [{campo, problema}]`.
- Toda resposta de sessão inclui `dono_atual` (FR-012).

## Endpoints

### GET /api/health

`200 {"status": "ok"}` — sem autenticação, usado pelo watchtower/compose.

### GET /api/me

Identidade do chamador (claim do JWT do Access, upsert no cache `usuarios`).

```json
200 {"email": "ana@corp", "nome": "Ana"}
```

### GET /api/sso

Hop de login (sem auth): `302` para `return` se a origem estiver em `HARNESS_FRONTEND_ORIGINS`; origem inválida → `422`. O Access intercepta esta navegação (Google one-click) e devolve o cookie `CF_Authorization` do domínio da API. Parâmetro: `?return=https://harness-frontend.giomartins.dev/...`.

### POST /api/sessoes

Cria sessão (US-1). Se `origem_id` presente, cria **extensão** (US-4): copia `contexto_md` e `proximos_passos_md` da origem como estado inicial (campos enviados no body **sobrescrevem** a cópia) e registra `extensao_criada` na timeline da origem.

Request:

```json
{
  "titulo": "refatorar auth do bet-api",
  "objetivo": "trocar JWT por sessões de servidor",
  "repo": "bet-api@feat/auth-sessions",
  "contexto_md": "decisões: ...\ngotchas: ...",
  "proximos_passos_md": "1. middleware\n2. testes",
  "origem_id": 7
}
```

- `titulo`, `objetivo` obrigatórios; demais opcionais. `origem_id` deve existir.

Response `201`:

```json
{
  "id": 12, "titulo": "...", "objetivo": "...", "repo": "bet-api@feat/auth-sessions",
  "contexto_md": "...", "proximos_passos_md": "...", "status": "em_andamento",
  "criador": {"email": "a@corp", "nome": "A"}, "dono_atual": {"email": "a@corp", "nome": "A"},
  "pr_link": null, "origem_id": 7, "criado_em": 1789000000, "atualizado_em": 1789000000
}
```

### GET /api/sessoes

Lista do time (US-3). Query: `status` (`em_andamento|entregue|arquivada`, repetível), `dono` (e-mail), `origem` (id — extensões de uma sessão). Ordenação fixa: `em_andamento` primeiro, depois por `atualizado_em` desc.

```json
200 {
  "sessoes": [
    {"id": 12, "titulo": "...", "repo": "bet-api", "status": "em_andamento",
     "dono_atual": {"email": "b@corp", "nome": "B"}, "criador": {"email": "a@corp", "nome": "A"},
     "origem_id": null, "atualizado_em": 1789000100,
     "resumo_objetivo": "trocar JWT por sessões de servidor"}
  ]
}
```

### GET /api/sessoes/{id}

Detalhe completo (US-3): campos da sessão + `origem` (resumo da sessão de origem, se extensão) + `extensoes` (resumo das filhas).

```json
200 {
  "id": 12, "...": "campos como no POST",
  "origem": {"id": 7, "titulo": "auth bet-api", "status": "em_andamento"},
  "extensoes": [{"id": 15, "titulo": "cobrir o runner também", "status": "em_andamento", "dono_atual": {"email": "c@corp", "nome": "C"}}]
}
```

`404` `{"erro":{"codigo":"nao_encontrado","mensagem":"..."}}` se não existir.

### PATCH /api/sessoes/{id}

Edita `contexto_md` e/ou `proximos_passos_md` (US-2, FR-006). Concorrência otimista: envie `base_atualizado_em` (valor `atualizado_em` que o cliente viu); se difere do atual → `409` com o corpo atual da sessão; repita com `"force": true` para sobrescrever (última escrita vence). Evento `atualizacao_contexto` na timeline.

```json
{"contexto_md": "novo texto", "proximos_passos_md": "novo", "base_atualizado_em": 1789000100, "force": false}
```

`200` → sessão atualizada (mesma forma do GET). `409` → `{"erro":{"codigo":"conflito",...}}` + `sessao` (estado vigente).

### POST /api/sessoes/{id}/retomar

Retomada (US-2, FR-005): o chamador assume a baton. Corpo vazio.

```json
200 {"id": 12, "dono_atual": {"email": "b@corp", "nome": "B"}, "...": "sessão completa"}
```

Se o chamador já é o dono: `200` idempotente sem evento duplicado. Timeline recebe `retomada` (`dono_anterior` → `dono_novo`) quando o dono muda.

### POST /api/sessoes/{id}/status

Muda status (US-5, FR-010): `{"acao": "entregar" | "arquivar" | "reabrir", "pr_link": "https://..."}` (`pr_link` só relevante em `entregar`).

- `200` sessão atualizada + evento `status_mudou`.
- Transição não permitida (ver `data-model.md`) → `422` `transicao_invalida`.

### GET /api/sessoes/{id}/eventos

Timeline cronológica ascendente (FR-007).

```json
200 {"eventos": [
  {"id": 1, "tipo": "criacao", "autor": {"email": "a@corp", "nome": "A"}, "payload": {"titulo": "refatorar auth do bet-api"}, "criado_em": 1789000000},
  {"id": 4, "tipo": "retomada", "autor": {"email": "b@corp", "nome": "B"}, "payload": {"dono_anterior": "a@corp", "dono_novo": "b@corp"}, "criado_em": 1789000300},
  {"id": 9, "tipo": "status_mudou", "autor": {"email": "b@corp", "nome": "B"}, "payload": {"de": "em_andamento", "para": "entregue", "pr_link": "https://github.com/..."}, "criado_em": 1789001200}
]}
```

## Página do frontend (contrato de UI)

Rotas SPA do `harness-frontend`:

| Rota | Conteúdo |
|---|---|
| `/` | Lista de sessões (filtros status/dono; ativas em destaque) — US-3 |
| `/sessoes/nova` | Form de criação (campos do POST; se `?origem=ID`, form de extensão com contexto pré-preenchido) — US-1/US-4 |
| `/sessoes/{id}` | Página da sessão: objetivo, dono atual em destaque, contexto + próximos passos (markdown sanitizado), timeline, ações: Retomar / Estender / Entregar / Arquivar / Reabrir — US-2/4/5 |
| — | Login não é rota do SPA: probe `GET /api/me` (`redirect:"manual"`); não autenticado → navegação top-level para `GET {API}/api/sso?return=<origem>` (hop 302, Access intercepta — padrão bet-api, ver `research.md` D3) |

Estados de erro: `409` de edição abre diálogo "conteúdo mudou desde a abertura — sobrescrever?"; falha de rede mantém rascunho em `localStorage` (edge cases da spec).