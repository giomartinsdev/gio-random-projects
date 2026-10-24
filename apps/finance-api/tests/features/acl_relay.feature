# language: pt
# A ACL do financeiro: o que ela promete ao worker do WhatsApp.
#
# O comportamento que estes cenários fixam é o contrato do §4.1 e o detalhe
# que mais custa caro quando se perde:
#   - `504` do domain-api significa "ficou na fila, ainda pode ser aplicado" e
#     NÃO "não foi escrito" -- quem confunde os dois avisa o usuário errado;
#   - a ACL valida antes de repassar, então um valor inexato ou um horário sem
#     fuso morre aqui, sem gastar ida e volta;
#   - sem `X-API-Key` válida não há repasse nenhum.
#
# Roda com o domain-api SIMULADO por um httpx.MockTransport, não mockado o
# cliente: o código do `DomainApiClient` de verdade é o que traduz os status,
# então o que se testa é a tradução, não um dublê dela.

Funcionalidade: Repasse de comando da ACL para o domain-api
  Como o worker do WhatsApp
  Quero mandar um comando para a finance-api
  Para que ele chegue ao domain-api com a forma que a casa espera

  Cenário: Comando aplicado é confirmado
    Dado que o domain-api vai responder "written"
    Quando eu mando um comando de despesa válido
    Então a resposta é "written" com o entity_id
    E a resposta tem status HTTP 200

  Cenário: Timeout do domain-api não é falha
    Dado que o domain-api vai responder "queued"
    Quando eu mando um comando de despesa válido
    Então a resposta é "queued" com status HTTP 504
    E a resposta avisa que o comando ainda pode ser aplicado

  Cenário: Comando rejeitado explica o motivo
    Dado que o domain-api vai responder "failed"
    Quando eu mando um comando de despesa válido
    Então a resposta é "failed" com status HTTP 422

  Cenário: Valor inexato é recusado antes do repasse
    Dado que o domain-api vai responder "written"
    Quando eu mando um comando de despesa com valor em ponto flutuante
    Então a resposta é recusada com status HTTP 422
    E nenhum request foi feito ao domain-api

  Cenário: Horário sem fuso é recusado antes do repasse
    Dado que o domain-api vai responder "written"
    Quando eu mando um comando de despesa com horário sem fuso
    Então a resposta é recusada com status HTTP 422
    E nenhum request foi feito ao domain-api

  Cenário: Sem chave não há repasse
    Dado que o domain-api vai responder "written"
    Quando eu mando um comando sem a chave de API
    Então a resposta é não autorizada com status HTTP 401
    E nenhum request foi feito ao domain-api
