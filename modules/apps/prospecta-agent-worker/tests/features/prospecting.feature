# language: pt
# A prospecção (US2, research R1): o run é uma MÁQUINA DE ESTADOS própria sobre
# o evento `ProspectRequested` do exchange `domain.events` -- `plan → search →
# enrich → qualify` --, não um framework. Cada transição persiste o estado do
# run na prospecta-api; nunca fica na memória do processo.
#
#   - o run JÁ é criado pelo domínio: o `ProspectRequested` carrega `run_id` e o
#     worker só o ATUALIZA (`POST /agent/runs/{id}`), nunca abre um segundo;
#   - o lead descoberto é PERSISTIDO na prospecta-api (`POST /leads` + qualify),
#     além de publicado no bus -- upsert idempotente por `domain`/`company_name`;
#   - retry/backoff + circuit-breaker por dependência; um 9router 5xx persistente
#     termina o run em `failed` e NÃO loopa a fila; busca não configurada/vazia
#     degrada para `done` com found 0 (não `failed` em loop);
#   - idempotência por `event_id`/`command_id`: a reentrega não conduz o run duas vezes;
#   - dedup por chave natural (`domain`/`company_name`): o mesmo negócio não vira
#     dois leads.
#
# O domínio publica `LeadQualified` de volta; aí o composer redige a abordagem e
# publica `MessageDrafted` (tom de voz + rodapé de opt-out).
#
# O 9router, a busca, o enriquecimento e a prospecta-api são upstreams HTTP reais
# (um container): o teste exercita a travessia de rede, não um dublê.

Funcionalidade: O agente prospecta, qualifica e redige
  Como o núcleo agêntico do Prospecta
  Quero consumir ProspectRequested e produzir LeadDiscovered/LeadEnriched/LeadQualified
  Para encher o pipeline sem loopar nem duplicar leads

  Cenário: Um ProspectRequested inicia o run e produz um lead qualificado
    Dado uma campanha "camp-1" com o ICP "Logística B2B, expandindo frota"
    E que a busca devolve o prospect "Northwind Log" em "https://northwindlog.com.br"
    E que o enriquecimento devolve a empresa "Northwind Log" com o decisor "Carlos Menezes"
    E que o 9router devolve o fit 87 para o lead
    Quando o domínio publica o evento "ProspectRequested" para a campanha "camp-1"
    Então o worker publicou o evento "LeadDiscovered"
    E o worker publicou o evento "LeadEnriched"
    E o worker publicou o evento "LeadQualified" com fit 87
    E o lead "Northwind Log" foi persistido na prospecta-api
    E o lead "Northwind Log" foi qualificado com fit 87
    E o run da campanha "camp-1" terminou no estado "done"

  Cenário: O run usa o run_id que veio no evento (o domínio cria o run)
    Dado uma campanha "camp-1" com o ICP "Logística B2B, expandindo frota"
    E que a busca devolve o prospect "Northwind Log" em "https://northwindlog.com.br"
    E que o enriquecimento devolve a empresa "Northwind Log" com o decisor "Carlos Menezes"
    E que o 9router devolve o fit 87 para o lead
    Quando o domínio publica o evento "ProspectRequested" para a campanha "camp-1"
    Então o worker NÃO abriu um novo run
    E o run do evento "run-from-event" recebeu o estado "done"

  Cenário: A reentrega do mesmo ProspectRequested não conduz o run duas vezes
    Dado uma campanha "camp-1" com o ICP "Logística B2B, expandindo frota"
    E que a busca devolve o prospect "Northwind Log" em "https://northwindlog.com.br"
    E que o enriquecimento devolve a empresa "Northwind Log" com o decisor "Carlos Menezes"
    E que o 9router devolve o fit 87 para o lead
    Quando o domínio publica o evento "ProspectRequested" duas vezes para a campanha "camp-1"
    Então o run do evento "run-from-event" recebeu o estado "done" uma vez

  Cenário: Uma busca sem resultados termina o run sem lead e sem loop
    Dado uma campanha "camp-1" com o ICP "Logística B2B, expandindo frota"
    E que a busca não devolve resultados
    Quando o domínio publica o evento "ProspectRequested" para a campanha "camp-1"
    Então o worker não publicou nenhum evento
    E o run do evento "run-from-event" recebeu o estado "done" uma vez

  Cenário: Uma busca não configurada (sem chave) degrada para done sem lead
    Dado uma campanha "camp-1" com o ICP "Logística B2B, expandindo frota"
    E que a busca não está configurada
    Quando o domínio publica o evento "ProspectRequested" para a campanha "camp-1"
    Então o worker não publicou nenhum evento
    E o run do evento "run-from-event" terminou no estado "done" com found 0

  Cenário: O mesmo negócio duas vezes não vira dois leads
    Dado uma campanha "camp-1" com o ICP "Logística B2B, expandindo frota"
    E que a busca devolve "Northwind Log" e de novo "Northwind Log"
    E que o enriquecimento devolve a empresa "Northwind Log" com o decisor "Carlos Menezes"
    E que o 9router devolve o fit 87 para o lead
    Quando o domínio publica o evento "ProspectRequested" para a campanha "camp-1"
    Então o worker publicou o evento "LeadDiscovered" uma vez

  Cenário: Um 9router 5xx persistente não mata o run; o lead fica com fit 0
    Dado uma campanha "camp-1" com o ICP "Logística B2B, expandindo frota"
    E que a busca devolve o prospect "Northwind Log" em "https://northwindlog.com.br"
    E que o 9router responde 500 permanentemente
    Quando o domínio publica o evento "ProspectRequested" para a campanha "camp-1"
    Então o run da campanha "camp-1" terminou no estado "done"
    E o lead "Northwind Log" foi persistido na prospecta-api
    E o 9router recebeu menos de 10 chamadas

  Cenário: Um LeadQualified faz o composer redigir e publicar MessageDrafted
    Dado um lead "lead-1" no canal "whatsapp" com tom "próximo e direto"
    E que o 9router responde com sucesso
    Quando o domínio publica o evento "LeadQualified" para o lead "lead-1"
    Então o worker publicou o evento "MessageDrafted"
    E a mensagem redigida tem rodapé de opt-out
    E a mensagem redigida foi persistida na prospecta-api
    E a chamada ao 9router não contém o telefone "5521981962914"

  # O worker é principal de SISTEMA e processa eventos de VÁRIOS tenants. Sem o
  # header `X-Tenant-Id` ele lê/escreve no tenant fixo do operador -- a campanha
  # de um usuário dá 404 e os leads vão para o tenant errado. Estes cenários
  # provam que o tenant do EVENTO é REPASSADO em cada rota da prospecta-api.

  Cenário: O worker repassa o tenant do evento para a prospecta-api
    Dado uma campanha "camp-1" com o ICP "Logística B2B, expandindo frota"
    E que a campanha "camp-1" pertence ao tenant "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    E que a busca devolve o prospect "Northwind Log" em "https://northwindlog.com.br"
    E que o enriquecimento devolve a empresa "Northwind Log" com o decisor "Carlos Menezes"
    E que o 9router devolve o fit 87 para o lead
    E que o evento carrega o tenant "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    Quando o domínio publica o evento "ProspectRequested" para a campanha "camp-1"
    Então o run do evento "run-from-event" recebeu o estado "done"
    E a prospecta-api leu a campanha "camp-1" no tenant "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    E a prospecta-api persistiu o lead no tenant "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    E a prospecta-api qualificou o lead no tenant "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    E a prospecta-api atualizou o run "run-from-event" no tenant "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

  Cenário: get_campaign usa o tenant do EVENTO (não o do operador) para resolver a campanha
    Dado uma campanha "camp-1" com o ICP "Logística B2B, expandindo frota"
    E que a campanha "camp-1" pertence ao tenant "bbbbbbbb-cccc-dddd-eeee-ffffffffffff"
    E que a busca não devolve resultados
    E que o evento carrega o tenant "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    Quando o domínio publica o evento "ProspectRequested" para a campanha "camp-1"
    Então a prospecta-api leu a campanha "camp-1" no tenant "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

  Cenário: O composer repassa o tenant do evento nas leituras e na persistência
    Dado um lead "lead-1" no canal "whatsapp" com tom "próximo e direto"
    E que o 9router responde com sucesso
    E que o evento carrega o tenant "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    Quando o domínio publica o evento "LeadQualified" para o lead "lead-1"
    Então o worker publicou o evento "MessageDrafted"
    E a prospecta-api leu o lead "lead-1" no tenant "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    E a prospecta-api persistiu a mensagem no tenant "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

