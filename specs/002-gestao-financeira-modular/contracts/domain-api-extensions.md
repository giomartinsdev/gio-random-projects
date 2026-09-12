# Contrato: extensões da domain-api / domain-worker

Estas rotas/agregados são internos ao ecossistema — só os 4 microsserviços
de módulo (e ninguém mais) chamam a `domain-api` com sua própria
`X-API-Key`. O frontend nunca fala diretamente com a `domain-api`.

Segue exatamente o envelope já documentado no README da `domain-api`:
`POST` publica `{"action", "payload"}`, resposta `202
{"command_id","status":"accepted"}` (assíncrono) ou, via `POST /sync`, uma
resposta que só chega quando o `domain-worker` já confirmou a escrita
(`200 written` / `422 failed` / `504 queued`).

## Novas actions no domain-worker (dispatch por prefixo)

| Prefixo | Actions | Rota HTTP usada |
|---|---|---|
| `conta.` | `conta.criar`, `conta.editar`, `conta.arquivar` | `/sync` (feedback imediato de UI) |
| `transacao.` | `transacao.criar`, `transacao.editar`, `transacao.excluir` | `202` (alto volume, UI já otimiza local) |
| `ativo.` | `ativo.criar`, `ativo.registrarMovimento` (compra/venda/provento), `ativo.atualizarCotacao` | `/sync` para criar/movimentar; `202` para `atualizarCotacao` (call de background do Asset Manager) |
| `dashboardlayout.` | `dashboardlayout.salvar` | `/sync` |

## Novos endpoints de leitura na domain-api

| Rota | O que devolve |
|---|---|
| `GET /contas?usuario=` | contas da pessoa usuária, `status` opcional no filtro |
| `GET /contas/{id}` | detalhe de uma conta |
| `GET /transacoes?usuario=&conta=&de=&ate=&categoria=` | transações filtradas (US2, FR-022) |
| `GET /ativos?usuario=&conta=` | posições de ativos de uma pessoa usuária/conta |
| `GET /ativos/{id}/movimentos` | histórico de compras/vendas/proventos de um ativo |
| `GET /dashboardlayouts/{usuario}` | layout ativo da pessoa usuária (404 → frontend usa o padrão embutido) |

Todos exigem `X-API-Key` do serviço chamador, como qualquer outra rota da
`domain-api` hoje.

## Novas tabelas (Postgres compartilhado, gerenciadas pelo domain-worker)

`contas`, `transacoes`, `ativos`, `ativo_movimentos`, `dashboard_layouts` —
esquema detalhado em [`../data-model.md`](../data-model.md). Migrations
seguem o padrão já usado pelo domain-worker para os agregados existentes
(um arquivo de migration por agregado, aplicado no boot do worker).
