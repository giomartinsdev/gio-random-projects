# language: pt
# Leis do Prospecta que faltavam no domain-api (specs/004-prospecta).
#
# A prospecta-api (ACL, sem banco) lê as projeções do par de domínio. Até aqui o
# domain-api só expunha Company/ICP; as rotas de Campaign, Lead, Conversation,
# Message e o feed SSE de atividade respondiam 404. Estes cenários fixam o
# contrato das leituras que faltavam, no molde de GetCompany:
#
#   - tenant_id vem por query (?tenant_id=); ausente é 400;
#   - id inexistente é 404;
#   - paginação por cursor devolve {items, next};
#   - os shapes JSON são EXATAMENTE os que a prospecta-api decodifica
#     (internal/domain/*.go dela é a fonte de verdade do contrato);
#   - RLS + filtro explícito por tenant: um tenant não vê dados de outro.
#
# Roda contra Postgres REAL (testcontainers, o schema do domain-worker) e sobe
# o router de produção, então o que se prova é a query, o RLS e o wiring.
# O feed SSE é lido linha a linha por um cliente HTTP de verdade.

Funcionalidade: Leituras do Prospecta no domain-api
  Como a prospecta-api (ACL sem banco)
  Quero ler as projeções de Campaign, Lead, Conversation, Message e atividade
  Para operar o pipeline sem tocar no Postgres

  Cenário: Listar campanhas devolve a página com items
    Dado um banco de domínio limpo
    E uma campanha do tenant "11111111-1111-1111-1111-111111111111" chamada "Sudeste"
    E uma campanha do tenant "11111111-1111-1111-1111-111111111111" chamada "Sul"
    Quando eu faço GET "/campaigns?tenant_id=11111111-1111-1111-1111-111111111111"
    Então a resposta tem status HTTP 200
    E o corpo traz a lista "items" com 2 itens

  Cenário: Listar campanhas com limit devolve next não vazio
    Dado um banco de domínio limpo
    E uma campanha do tenant "11111111-1111-1111-1111-111111111111" chamada "Sudeste"
    E uma campanha do tenant "11111111-1111-1111-1111-111111111111" chamada "Sul"
    Quando eu faço GET "/campaigns?tenant_id=11111111-1111-1111-1111-111111111111&limit=1"
    Então a resposta tem status HTTP 200
    E o corpo traz a lista "items" com 1 itens
    E a resposta traz um "next" não vazio

  Cenário: Ler campanha inexistente devolve 404
    Dado um banco de domínio limpo
    Quando eu faço GET "/campaigns/00000000-0000-0000-0000-000000000000?tenant_id=11111111-1111-1111-1111-111111111111"
    Então a resposta tem status HTTP 404

  Cenário: Sem tenant_id a leitura é recusada com 400
    Dado um banco de domínio limpo
    Quando eu faço GET "/campaigns"
    Então a resposta tem status HTTP 400

  Cenário: Outro tenant não vê a campanha
    Dado um banco de domínio limpo
    E uma campanha do tenant "11111111-1111-1111-1111-111111111111" chamada "Sudeste"
    Quando eu faço GET "/campaigns?tenant_id=22222222-2222-2222-2222-222222222222"
    Então a resposta tem status HTTP 200
    E o corpo traz a lista "items" com 0 itens

  Cenário: Listar leads filtra por campanha, status e fit mínimo
    Dado um banco de domínio limpo
    E um lead do tenant "11111111-1111-1111-1111-111111111111" na campanha "aaaaaaaa-0000-0000-0000-000000000001" com fit 80 e status "qualified"
    E um lead do tenant "11111111-1111-1111-1111-111111111111" na campanha "aaaaaaaa-0000-0000-0000-000000000001" com fit 40 e status "discovered"
    Quando eu faço GET "/leads?tenant_id=11111111-1111-1111-1111-111111111111&campaign_id=aaaaaaaa-0000-0000-0000-000000000001&fit_min=70"
    Então a resposta tem status HTTP 200
    E o corpo traz a lista "items" com 1 itens

  Cenário: Ler lead existente devolve o detalhe com enriquecimento
    Dado um banco de domínio limpo
    E um lead do tenant "11111111-1111-1111-1111-111111111111" na campanha "aaaaaaaa-0000-0000-0000-000000000001" com fit 80 e status "qualified"
    Quando eu leio o lead cadastrado
    Então a resposta tem status HTTP 200
    E o corpo traz "company_name" igual a "Northwind Log"
    E o corpo traz "fit" igual a 80

  Cenário: Ler lead inexistente devolve 404
    Dado um banco de domínio limpo
    Quando eu faço GET "/leads/00000000-0000-0000-0000-000000000000?tenant_id=11111111-1111-1111-1111-111111111111"
    Então a resposta tem status HTTP 404

  Cenário: Listar conversas devolve o inbox paginado
    Dado um banco de domínio limpo
    E uma conversa do tenant "11111111-1111-1111-1111-111111111111" com thread "thread-1"
    Quando eu faço GET "/conversations?tenant_id=11111111-1111-1111-1111-111111111111"
    Então a resposta tem status HTTP 200
    E o corpo traz a lista "items" com 1 itens

  Cenário: Ler conversa devolve a thread ordenada
    Dado um banco de domínio limpo
    E uma conversa do tenant "11111111-1111-1111-1111-111111111111" com thread "thread-1"
    E duas mensagens na conversa uma "out" e outra "in"
    Quando eu leio a conversa cadastrada
    Então a resposta tem status HTTP 200
    E o corpo traz a lista "messages" com 2 itens

  Cenário: Ler conversa inexistente devolve 404
    Dado um banco de domínio limpo
    Quando eu faço GET "/conversations/00000000-0000-0000-0000-000000000000?tenant_id=11111111-1111-1111-1111-111111111111"
    Então a resposta tem status HTTP 404

  Cenário: Ler mensagem existente devolve a projeção e inexistente é 404
    Dado um banco de domínio limpo
    E um lead do tenant "11111111-1111-1111-1111-111111111111" na campanha "aaaaaaaa-0000-0000-0000-000000000001" com fit 80 e status "qualified"
    E uma mensagem "drafted" no lead cadastrado
    Quando eu leio a mensagem cadastrada
    Então a resposta tem status HTTP 200
    E o corpo traz "status" igual a "drafted"
    E eu leio a mensagem inexistente
    Então a resposta tem status HTTP 404

  Cenário: O feed de atividade entrega o run do tenant
    Dado um banco de domínio limpo
    E um run do agente "prospector" em "running" no tenant "11111111-1111-1111-1111-111111111111"
    Quando eu abro o feed "/agent/activity?tenant_id=11111111-1111-1111-1111-111111111111"
    Então o feed responde "text/event-stream"
    E o feed entrega o primeiro evento com "state" igual a "running"
    E o feed entrega o primeiro evento com "agent" igual a "prospector"

  Cenário: O feed sem tenant_id é recusado com 400
    Dado um banco de domínio limpo
    Quando eu abro o feed "/agent/activity"
    Então a resposta tem status HTTP 400

  Cenário: Cliente que desconecta encerra o feed sem vazar goroutine
    Dado um banco de domínio limpo
    E um run do agente "prospector" em "running" no tenant "11111111-1111-1111-1111-111111111111"
    Quando eu abro o feed "/agent/activity?tenant_id=11111111-1111-1111-1111-111111111111" e depois desconecto
    Então nenhuma goroutine do feed fica pendurada
