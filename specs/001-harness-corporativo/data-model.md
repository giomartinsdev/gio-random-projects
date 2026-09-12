# Data Model — Harness Corporativo (specs/001-harness-corporativo)

Entidades derivadas de `spec.md`. SQLite como store; tipos abaixo em termos SQL.

## 1. Sessão (tabela `sessoes`)

Uma implementação que o time inicia, retoma e estende.

| Campo | Tipo | Regras |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | exposto como ID opaco numérico |
| `titulo` | TEXT NOT NULL | 1–200 chars, trim |
| `objetivo` | TEXT NOT NULL | 1–5.000 chars |
| `repo` | TEXT NULL | texto livre (ex.: `bet-api`, `bet-api@branch`), ≤200 chars |
| `contexto_md` | TEXT NULL | markdown, ≤ 65.536 bytes (64 KB) |
| `proximos_passos_md` | TEXT NULL | markdown, ≤ 16.384 bytes (16 KB) |
| `status` | TEXT NOT NULL CHECK | `em_andamento` \| `entregue` \| `arquivada`; default `em_andamento` |
| `criador_email` | TEXT NOT NULL | identidade Access (e-mail) |
| `dono_atual_email` | TEXT NOT NULL | quem está com a baton; nasce = criador; muda só por retomada |
| `pr_link` | TEXT NULL | preenchido ao marcar entregue (opcional), ≤ 500 chars |
| `origem_id` | INTEGER NULL FK → `sessoes.id` | preenchido quando a sessão é extensão de outra |
| `criado_em` | INTEGER NOT NULL | unix epoch seconds |
| `atualizado_em` | INTEGER NOT NULL | unix epoch seconds; atualizado a qualquer mutação da sessão |

Índices: `status`, `dono_atual_email`, `origem_id`, `atualizado_em DESC` (lista ordenada por atividade).

### Transições de status

```text
em_andamento ──entregar──▶ entregue
em_andamento ──arquivar──▶ arquivada
entregue    ──arquivar──▶ arquivada
entregue    ──reabrir───▶ em_andamento
arquivada   ──reabrir───▶ em_andamento
```

Qualquer outra transição é recusada (400). Reabrir/entregar/arquivar não muda o dono atual.

### Regras de concorrência

- **Retomada**: não há lock. Última retomada confirmada vence (UPDATE do `dono_atual_email`); cada retomada gera evento, então as duas tentativas aparecem na timeline em ordem.
- **Edição de contexto/próximos passos**: otimista — o cliente envia `base_atualizado_em`; se difere do valor atual, API responde `409` com o conteúdo vigente; o cliente avisa e o usuário pode forçar sobrescrita (retry com `force: true`). Última escrita vence.

## 2. Evento de timeline (tabela `eventos`)

Registro imutável de tudo que acontece numa sessão (FR-007, SC-004).

| Campo | Tipo | Regras |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `sessao_id` | INTEGER NOT NULL FK → `sessoes.id` | ON DELETE CASCADE (arquivo apagado leva os eventos) |
| `tipo` | TEXT NOT NULL CHECK | `criacao` \| `retomada` \| `atualizacao_contexto` \| `extensao_criada` \| `status_mudou` |
| `autor_email` | TEXT NOT NULL | identidade Access de quem fez |
| `payload` | TEXT NULL | JSON resumido; ver abaixo |
| `criado_em` | INTEGER NOT NULL | unix epoch seconds |

`payload` por tipo:

- `criacao`: `{"titulo": "..."}`
- `retomada`: `{"dono_anterior": "a@x", "dono_novo": "b@x"}`
- `atualizacao_contexto`: `{"campos": ["contexto_md","proximos_passos_md"], "force": false}`
- `extensao_criada`: `{"extensao_id": 42, "titulo": "..."}`
- `status_mudou`: `{"de": "em_andamento", "para": "entregue", "pr_link": "https://..."}`

Índice: `sessao_id, criado_em ASC` (timeline cronológica). Sem UPDATE/DELETE — append-only.

## 3. Usuário (tabela `usuarios`) — cache derivado do Access

Sem cadastro: o app confia no JWT do Access e só **cacheia** nome para exibir timeline/lista de outras pessoas (a sessão do usuário logado tem o nome no próprio JWT).

| Campo | Tipo | Regras |
|---|---|---|
| `email` | TEXT PK | identidade Access |
| `nome` | TEXT NOT NULL | claim de nome do Access (fallback: parte local do e-mail) |
| `ultima_visita` | INTEGER NOT NULL | upsert a cada request autenticado |

## Relacionamentos

```text
sessoes 1 ──── N eventos            (timeline, append-only)
sessoes 1 ──── N sessoes            (origem_id → extensões; cópia inicial de contexto na criação)
usuarios(email) ←──────────────     (criador_email, dono_atual_email, eventos.autor_email — por e-mail, sem FK)
```

## Validações resumidas (aplicadas na API)

- Sessão: `titulo` e `objetivo` obrigatórios; limites conforme tabela acima; `origem_id` deve apontar para sessão existente.
- Evento: criado apenas internamente pelas operações da API (nunca via endpoint de escrita).
- Status: apenas transições do diagrama acima.
- Autenticação: toda rota exige JWT válido do Access (exceto healthcheck).