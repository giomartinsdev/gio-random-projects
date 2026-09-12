# Quickstart: validando a Gestão Financeira Modular

Guia de validação funcional ponta a ponta, local e em produção. Não
contém código de implementação — os passos assumem que os 4 backends,
o `domain-worker`/`domain-api` estendidos e o `financas-frontend` já
existem (pós-implementação).

## Pré-requisitos

- Postgres e Redis compartilhados rodando (mesmo `compose.yaml` da raiz de
  `modules/apps`, como qualquer app do repo).
- `domain-api` e `domain-worker` rodando com os 4 novos agregados
  aplicados (migrations do `conta`, `transacao`, `ativo`,
  `dashboard_layout`).
- Uma chave `X-API-Key` gerada para cada um dos 4 módulos (variável de
  ambiente de cada serviço, ver seus respectivos `.env.example`).
- `ASSET_MANAGER_BRAPI_TOKEN` configurado no `asset-manager-api` (segredo
  de infraestrutura — não commitar; local, usar o token de teste do plano
  gratuito exportado só na shell).
- Bypass de auth de desenvolvimento ligado em cada backend
  (`<MODULO>_DEV_BYPASS_AUTH=1` + `<MODULO>_DEV_USER_EMAIL`), como já é
  padrão em `harness-api`, para não depender do Cloudflare Access local.

## Setup local

```sh
# cada um dos 4 backends, em terminais separados
cd modules/apps/contas-api            && go run .
cd modules/apps/transacional-api      && go run .
cd modules/apps/asset-manager-api     && go run .
cd modules/apps/dashboard-api         && go run .

# frontend
cd modules/apps/financas-frontend
npm install && npm run dev
```

## Cenário 1 — Contas (US1, SC-001)

1. Abrir o frontend, logar (ou usar o bypass de dev).
2. Criar uma conta `Nubank` do tipo `corrente`.
3. Criar uma conta `Clear` do tipo `investimento`.
4. **Esperado**: as duas aparecem na lista; tempo total da ação
   (login → 2 contas criadas) abaixo de 3 minutos (SC-001, mais folgado
   para incluir a criação da segunda conta).
5. Tentar excluir a conta `Nubank` depois de lançar uma transação nela
   (cenário 2) — **esperado**: a API recusa a exclusão definitiva e
   oferece arquivar (FR-012).

## Cenário 2 — Transações do dia a dia (US2)

1. Com a conta `Nubank` criada, lançar uma transação de saída de R$ 50,00,
   categoria "Mercado", hoje.
2. Lançar uma segunda transação de entrada de R$ 3.000,00, categoria
   "Salário".
3. Filtrar por categoria "Mercado" — **esperado**: só a primeira aparece
   (FR-022).
4. Anexar uma imagem (foto de nota) numa nova transação — **esperado**: a
   transação é salva com o anexo, sem nenhum dado extraído
   automaticamente ainda (FR-023).
5. Editar o valor da transação de "Mercado" para R$ 45,00 — **esperado**:
   o extrato e o total do período refletem o novo valor imediatamente
   (FR-021).

## Cenário 3 — Investimentos (US4)

1. Na conta `Clear`, cadastrar o ativo `PETR4`, quantidade 10, preço pago
   R$ 30,00.
2. **Esperado**: a carteira mostra custo total R$ 300,00 e, assim que a
   cotação da brapi.dev responder, valor de mercado e rentabilidade
   calculados (FR-031, FR-032).
3. Desligar a rede/token temporariamente e recarregar a tela — **esperado**:
   o último valor conhecido aparece marcado como desatualizado, a tela não
   quebra (FR-035).
4. Registrar um provento de R$ 5,00 para `PETR4` — **esperado**: a
   rentabilidade da posição sobe (FR-033).
5. Vender 5 unidades de `PETR4` a R$ 32,00 — **esperado**: resultado
   realizado calculado, posição continua `aberta` com quantidade 5
   (FR-034).

## Cenário 4 — Dashboard modular (US3, SC-002)

1. Acessar o dashboard sem nenhuma personalização prévia — **esperado**:
   layout padrão com saldo consolidado, gastos por categoria e evolução
   patrimonial (FR-040).
2. Adicionar um novo bloco: tipo "indicador", fonte = saldo da conta
   `Nubank` — **esperado**: bloco criado e configurado em menos de 1
   minuto (SC-002).
3. Redimensionar/mover o bloco, sair e voltar ao dashboard — **esperado**:
   a alteração persiste (FR-043).
4. Remover um bloco — **esperado**: some do layout, dados subjacentes
   intactos (FR-044 não afeta dados).
5. Arquivar a conta `Nubank` referenciada por um bloco existente e
   recarregar o dashboard — **esperado**: o bloco mostra estado de "fonte
   indisponível" em vez de quebrar a tela (edge case do spec).
6. Clicar "restaurar padrão" — **esperado**: volta ao layout inicial.

## Cenário 5 — Isolamento entre usuários (SC-005)

1. Logar como uma segunda identidade de teste (outro e-mail permitido).
2. **Esperado**: nenhuma conta, transação, ativo ou layout da primeira
   identidade aparece para a segunda (FR-002).

## Validação em produção (pós-deploy)

1. Repetir os cenários 1–4 em `financas.giomartins.dev` (via hub ou
   diretamente), logado com Google SSO real via Cloudflare Access.
2. Confirmar que os 4 hostnames (`contas-api`, `transacional-api`,
   `asset-manager-api`, `dashboard-api`) exigem login e que a sessão é
   compartilhada com o resto do ecossistema (logar uma vez, os 4 módulos
   já respondem autenticados).
3. Confirmar no Grafana (observability já ligado por convenção) que os 4
   novos serviços emitem logs/métricas/traces como qualquer outro app do
   repositório.
