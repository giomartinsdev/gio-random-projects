# dashboard-api

BFF do módulo Dashboard (US3 de
[`specs/002-gestao-financeira-modular`](../../../specs/002-gestao-financeira-modular/)).
Sem banco próprio: persiste a composição do layout do dashboard via HTTP
na `domain-api` compartilhada (agregado `dashboardlayout`). Não sabe
nada sobre os dados exibidos nos blocos (contas/transações/ativos) —
isso é responsabilidade do frontend e dos outros módulos.

## Rotas

| Rota | Comportamento |
|---|---|
| `GET /api/health` | sem auth |
| `GET /api/me` | identidade autenticada |
| `GET /api/sso?return=` | login hop (Cloudflare Access) |
| `GET /api/layout` | layout salvo da pessoa usuária, 404 se não houver |
| `PUT /api/layout` | salva/substitui `{"blocos": [...]}` |
| `DELETE /api/layout` | remove a personalização |

### Validação de `blocos`

Cada item precisa de `id`, `tipoVisualizacao` (`linha`, `barra`, `pizza`,
`indicador` ou `tabela`), `posicao {x, y}`, `tamanho {largura, altura}`
(ambos > 0) e `fonteDados` (objeto livre, conteúdo não validado — é
opaco para este serviço). Qualquer falha responde `422` com o código do
primeiro problema encontrado, sem chamar a `domain-api`.

## Rodando localmente

```bash
cp .env.example .env
# edite DASHBOARD_DOMAIN_API_URL/KEY para apontar pra domain-api local
go run .
```

Com `DASHBOARD_DEV_BYPASS_AUTH=1`, toda requisição roda como
`DASHBOARD_DEV_USER_EMAIL` sem precisar de um JWT do Cloudflare Access.

## Testes

```bash
go build ./...
go vet ./...
go test ./...
```
