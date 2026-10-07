# language: pt
# A prospecção (US2, research R1): o run é uma MÁQUINA DE ESTADOS própria sobre
# o evento `ProspectRequested` do exchange `domain.events` -- `plan → search →
# enrich → qualify` --, não um framework. Cada transição persiste o estado do
# run na prospecta-api; nunca fica na memória do processo.
#
#   - retry/backoff + circuit-breaker por dependência; um 9router 5xx persistente
#     termina o run em `failed` e NÃO loopa a fila;
#   - idempotência por `event_id`/`command_id`: a reentrega não abre um segundo run;
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
    E o run da campanha "camp-1" terminou no estado "done"

  Cenário: A reentrega do mesmo ProspectRequested não abre um segundo run
    Dado uma campanha "camp-1" com o ICP "Logística B2B, expandindo frota"
    E que a busca devolve o prospect "Northwind Log" em "https://northwindlog.com.br"
    E que o enriquecimento devolve a empresa "Northwind Log" com o decisor "Carlos Menezes"
    E que o 9router devolve o fit 87 para o lead
    Quando o domínio publica o evento "ProspectRequested" duas vezes para a campanha "camp-1"
    Então a prospecta-api registrou 1 run para a campanha "camp-1"

  Cenário: Uma busca sem resultados termina o run sem lead e sem loop
    Dado uma campanha "camp-1" com o ICP "Logística B2B, expandindo frota"
    E que a busca não devolve resultados
    Quando o domínio publica o evento "ProspectRequested" para a campanha "camp-1"
    Então o worker não publicou nenhum evento
    E o run da campanha "camp-1" terminou no estado "done"

  Cenário: O mesmo negócio duas vezes não vira dois leads
    Dado uma campanha "camp-1" com o ICP "Logística B2B, expandindo frota"
    E que a busca devolve "Northwind Log" e de novo "Northwind Log"
    E que o enriquecimento devolve a empresa "Northwind Log" com o decisor "Carlos Menezes"
    E que o 9router devolve o fit 87 para o lead
    Quando o domínio publica o evento "ProspectRequested" para a campanha "camp-1"
    Então o worker publicou o evento "LeadDiscovered" uma vez

  Cenário: Um 9router 5xx persistente termina o run em failed sem loop infinito
    Dado uma campanha "camp-1" com o ICP "Logística B2B, expandindo frota"
    E que a busca devolve o prospect "Northwind Log" em "https://northwindlog.com.br"
    E que o 9router responde 500 permanentemente
    Quando o domínio publica o evento "ProspectRequested" para a campanha "camp-1"
    Então o run da campanha "camp-1" terminou no estado "failed"
    E o 9router recebeu menos de 10 chamadas

  Cenário: Um LeadQualified faz o composer redigir e publicar MessageDrafted
    Dado um lead "lead-1" no canal "whatsapp" com tom "próximo e direto"
    E que o 9router responde com sucesso
    Quando o domínio publica o evento "LeadQualified" para o lead "lead-1"
    Então o worker publicou o evento "MessageDrafted"
    E a mensagem redigida tem rodapé de opt-out
    E a chamada ao 9router não contém o telefone "5521981962914"
