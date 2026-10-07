# db-mcp — MCP de leitura do banco

O `crystaldba/postgres-mcp` exposto ao agente (opencode) para consultar o
Postgres com **leitura**, respondendo a perguntas com dados reais — sem nunca
usar o usuário `domain` (superuser/dono das tabelas) e sem expor o banco.

## As três camadas

1. **Usuário `mcp_ro`** — `LOGIN`, só `SELECT` nas tabelas `finance_*`.
   Sem superuser, sem DDL, sem escrita; `SELECT` negado nas outras tabelas
   (ex.: `clubs`). Criado fora do compose (idempotente).
2. **`postgres-mcp --access-mode=restricted`** — transações read-only; o
   parser rejeita `COMMIT`/`ROLLBACK`/`DDL`/`DELETE`. Mesmo que o token vaze,
   o MCP não escreve.
3. **Gateway nginx com token bearer** (`MCP_DB_TOKEN`) — única porta que o
   ingress alcança (`127.0.0.1:8021`); sem token, `401` antes de chegar ao MCP.

## Como subir (boot-only, como o `core.yml`)

O stack **não** é gerenciado pelo Dockhand (o token fica numa variável de
stack que o Dockhand ainda não tem). Sobe por CLI na VPS, uma vez:

```bash
# 1. Segredos (NUNCA no git) — em /opt/giomartins/.env.db-mcp:
#    MCP_DB_PASSWORD=<senha do mcp_ro>
#    MCP_DB_TOKEN=<token bearer >=32 bytes>

# 2. Deploy
cd /opt/stacks/db-mcp
sudo docker compose --env-file /opt/giomartins/.env.db-mcp -f db-mcp.yml up -d
```

O `.env.db-mcp` referencia `MCP_DB_PASSWORD`; a mesma senha tem de estar
gravada no Postgres (ver "Usuário RO" abaixo).

## Usuário RO (idempotente)

```sql
CREATE ROLE mcp_ro WITH LOGIN PASSWORD '<MCP_DB_PASSWORD>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT CONNECT ON DATABASE domain TO mcp_ro;
GRANT USAGE ON SCHEMA public TO mcp_ro;
GRANT SELECT ON <todas as tabelas finance_*> TO mcp_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE domain IN SCHEMA public GRANT SELECT ON TABLES TO mcp_ro;
```

Para rotacionar a senha: `ALTER ROLE mcp_ro PASSWORD '<nova>'`, atualizar
`/opt/giomartins/.env.db-mcp` e recriar o container `db-mcp`.

## Endpoint

- Público: `https://db-mcp.giomartins.dev/sse` (SSE) — requer
  `Authorization: Bearer <MCP_DB_TOKEN>`.
- Ingress: `stacks/ingress/default.conf` (server block `db-mcp.giomartins.dev`
  → `127.0.0.1:8021`). DNS em `modules/infra/terraform/locals.tf` (hostname em
  `excluded_hostnames` — o MCP tem auth próprio, não Access).

## Rotação do token

1. Gerar novo (`openssl rand -hex 32`), atualizar `MCP_DB_TOKEN` no
   `.env.db-mcp`, `docker compose up -d db-mcp-gateway`.
2. Atualizar o header no `~/.config/opencode/opencode.json` (local).
