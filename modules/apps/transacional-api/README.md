# transacional-api

BFF do módulo Transacional (US2) da feature de gestão financeira pessoal
(`specs/002-gestao-financeira-modular/contracts/transacional-api.md`).
Sem banco de dados próprio: toda persistência de lançamentos (entradas e
saídas) passa pela `domain-api` compartilhada, nos agregados
`conta`/`transacao` que outro módulo mantém.

## Rotas

| Rota | Comportamento |
|---|---|
| `GET /api/health` | sem auth |
| `GET /api/me` | identidade da pessoa logada |
| `GET /api/sso?return=` | login hop do Cloudflare Access |
| `GET /api/transacoes?conta=&de=&ate=&categoria=` | lista transações da pessoa logada |
| `POST /api/transacoes` | cria transação |
| `PATCH /api/transacoes/{id}` | edita campos parciais |
| `DELETE /api/transacoes/{id}` | exclui |

## Validações locais (antes de chamar a domain-api)

- `valor`: numérico e `> 0` (`422 valor_invalido`)
- `data`: formato `YYYY-MM-DD` válido (`422 data_invalida`)
- `tipo`: `"entrada"` ou `"saida"` (`422 tipo_invalido`)
- `contaId`: obrigatório (`422 conta_obrigatoria`)
- `anexoImagem` (base64, com ou sem prefixo `data:<mime>;base64,`):
  `413` se o decodificado passar de `TRANSACIONAL_MAX_ANEXO_BYTES`,
  `415` se o content-type embutido não for `image/png`, `image/jpeg` ou
  `image/webp` (só checado quando vem como data URL).

## Validação que exige rede

Antes de criar (ou de editar trocando `contaId`), busca `GET
/contas/{id}` na domain-api e confere `status == "ativa"`; senão `422
conta_invalida`.

## Escrita/leitura na domain-api

Caminho assíncrono padrão (não `/sync` -- transação é alto volume):

- `POST /transacoes` / `PATCH /transacoes/{id}` / `DELETE
  /transacoes/{id}` → `202`
- `GET /transacoes?usuario=&conta=&de=&ate=&categoria=`

Qualquer erro de transporte ou status inesperado da domain-api vira
`502 domain_api_indisponivel` aqui.

## Rodando local

```bash
cp .env.example .env   # ajuste TRANSACIONAL_DOMAIN_API_URL/KEY
go run .
```

## Variáveis de ambiente

Ver `.env.example`.

## Testes

```bash
go build ./...
go vet ./...
go test ./...
```
