# Contrato: transacional-api

BFF do módulo Transacional (US2). Sem banco próprio. Valida contas
referenciadas chamando `contas-api`/domain-api antes de aceitar um
lançamento (edge case: conta arquivada/inexistente).

| Rota | O que faz | Requisito |
|---|---|---|
| `GET /api/health` | saúde, sem auth | — |
| `GET /api/me` / `GET /api/sso` | mesmo padrão de login que `contas-api` | FR-001 |
| `GET /api/transacoes` | lista com filtros `?conta=&de=&ate=&categoria=` | FR-022 |
| `POST /api/transacoes` | cria transação `{contaId, tipo, valor, data, categoria, descricao?, anexoImagem?}` | FR-020, FR-023, FR-024 |
| `PATCH /api/transacoes/{id}` | edita campos | FR-021 |
| `DELETE /api/transacoes/{id}` | exclui, recalcula totais afetados | FR-021 |

**Validações (FR-024)**: `valor` numérico > 0; `data` válida (não
obrigatoriamente passada — permite lançar no mesmo dia); `contaId` deve
existir e não estar arquivada no momento da criação, senão `422
conta_invalida`.

**Upload de imagem (FR-023)**: `anexoImagem` vai como base64 no corpo do
`POST`/`PATCH`; a API rejeita com `413` acima do limite de tamanho
configurado e com `415` para formatos não suportados (edge case do spec).
Nesta fase nenhum processamento de OCR ocorre — o campo só é armazenado
para uso futuro.
