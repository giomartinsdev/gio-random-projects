# Contrato: asset-manager-api

BFF do módulo Asset Manager (US4). Sem banco próprio para as posições
(vive na domain-api); mantém só um cache em memória (não durável) das
cotações consultadas na brapi.dev.

| Rota | O que faz | Requisito |
|---|---|---|
| `GET /api/health` | saúde, sem auth | — |
| `GET /api/me` / `GET /api/sso` | mesmo padrão de login dos demais módulos | FR-001 |
| `GET /api/ativos` | lista posições da pessoa usuária, com cotação atual/rentabilidade calculada (`?conta=`) | FR-030, FR-032 |
| `POST /api/ativos` | cadastra ativo `{contaId, ticker, quantidade, precoUnitario, data}` (primeira compra) | FR-030 |
| `POST /api/ativos/{id}/movimentos` | registra `{tipo: compra\|venda\|provento, ...}` | FR-033, FR-034 |
| `GET /api/ativos/{id}/movimentos` | histórico do ativo | US4 |
| `GET /api/cotacoes?tickers=A,B,C` | cotações atuais (cache-first, TTL curto), usado internamente pelo frontend para refresh manual | FR-031, FR-035 |

**Integração externa**: `internal/quotes` chama
`GET https://brapi.dev/api/quote/{tickers}` com o token lido de
`ASSET_MANAGER_BRAPI_TOKEN` (segredo de infraestrutura, nunca neste
repositório em texto claro) via header `Authorization: Bearer`. Cache em
memória por `ticker`, TTL curto (minutos). Se a chamada externa falhar ou
o ticker não retornar cotação, a API responde com o último
`ultimaCotacao`/`ultimaCotacaoEm` persistido no agregado `Ativo`
(domain-api) e um campo `desatualizada: true` (FR-035) — nunca `5xx` só
por causa da fonte externa estar fora do ar.

**Cálculo de rentabilidade (FR-032)**: por ativo,
`valorMercadoAtual = quantidadeAtual × ultimaCotacao`;
`rentabilidade = (valorMercadoAtual + proventosRecebidos - custoTotal) / custoTotal`.
Consolidado de carteira = soma por conta/usuário.
