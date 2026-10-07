# language: pt
# US4 — Atividade ao vivo (SSE). Contrato:
# specs/004-prospecta/contracts/prospecta-api.md §Activity.
#
# O feed não entrega um corpo JSON e termina; ele mantém a conexão aberta e
# emite eventos de `prospecta.agent_run` enquanto um run acontece:
#
#   event: agent
#   data: {"run_id":"...","agent":"prospector","state":"running","metric":{...}}
#
# Como a resposta é um stream, este .feature é o caso onde a infraestrutura real
# importa: o cliente é um httptest.NewServer de verdade e o cenário lê o corpo
# linha a linha. O par de domínio falso implementa GET /agent/activity e expõe
# /__activity/connections para provar que o cliente desconectado encerrou a
# stream sem vazar goroutine.

Funcionalidade: Feed de atividade ao vivo da prospecta-api
  Como o cockpit do Prospecta
  Quero ver os agentes trabalhando ao vivo
  Para acompanhar o run sem recarregar a página

  Cenário: Sem X-API-Key o feed é recusado
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu abro o feed "/agent/activity" sem o cabeçalho X-API-Key
    Então a resposta tem status HTTP 401

  Cenário: O feed entrega eventos de agent_run ao vivo
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu abro o feed "/agent/activity" e publico um run "running" e depois "done"
    Então o feed responde "text/event-stream"
    E o feed entrega o primeiro evento com "state" igual a "running"
    E o feed entrega o segundo evento com "state" igual a "done"

  Cenário: Cliente que desconecta encerra a stream sem vazar goroutine
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu abro o feed "/agent/activity" e depois desconecto
    Então o par de domínio vê a conexão encerrar
    E nenhuma goroutine do feed fica pendurada
