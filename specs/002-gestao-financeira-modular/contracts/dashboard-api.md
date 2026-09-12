# Contrato: dashboard-api

BFF do módulo Dashboard (US3). Sem banco próprio — persiste o layout via
domain-api. Não replica dados dos outros módulos: quando um bloco precisa
de dados de transações/ativos, o **frontend** busca direto em
`transacional-api`/`asset-manager-api`/`contas-api` (cada bloco já sabe sua
fonte); o `dashboard-api` só guarda a composição do layout, não os dados
exibidos nele.

| Rota | O que faz | Requisito |
|---|---|---|
| `GET /api/health` | saúde, sem auth | — |
| `GET /api/me` / `GET /api/sso` | mesmo padrão de login dos demais módulos | FR-001 |
| `GET /api/layout` | layout ativo da pessoa usuária (404 → frontend usa layout padrão embutido) | FR-040, FR-043 |
| `PUT /api/layout` | salva/substitui o layout `{blocos: [...]}` | FR-041, FR-042, FR-043 |
| `DELETE /api/layout` | remove a personalização (volta ao padrão) | FR-044 |

**Validação de bloco**: cada item de `blocos` precisa de `tipoVisualizacao`
∈ {`linha`,`barra`,`pizza`,`indicador`,`tabela`}, `posicao`, `tamanho` e uma
`fonteDados` reconhecível (conta/categoria/ativo) — mas a API **não**
valida se a fonte referenciada ainda existe (isso é responsabilidade do
frontend, que trata graciosamente o caso de conta arquiva/excluída, edge
case do spec) para manter o `dashboard-api` desacoplado dos outros
módulos.
