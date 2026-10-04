# language: pt
# O worker conversacional: o que ele promete ao usuário do WhatsApp.
#
# O gateway é a Evolution API (§5.3): a mensagem chega pelo RabbitMQ (fila
# `evolution.messages.upsert`) e a resposta sai por
# POST /message/sendText/{instance}. Estes cenários fixam o contrato inteiro
# dessa travessia:
#   - uma mensagem de texto do usuário vira um comando na finance-api e a
#     resposta volta pro WhatsApp;
#   - o eco da própria resposta (fromMe) NÃO vira comando -- senão o bot
#     conversaria consigo mesmo em loop;
#   - um evento que não é de mensagem é ignorado, sem erro;
#   - uma mensagem sem texto (áudio/imagem) é ignorada, sem quebrar o loop;
#   - um `data.key.id` já visto NÃO é processado duas vezes (entrega
#     at-least-once), e o efeito é único;
#   - falha do gateway (envio) não derruba o consumo.
#
# O Evolution é simulado por um publicador AMQP real (um container), e a
# finance-api por um stub HTTP real (um container): o que se testa é a
# travessia de rede, não um mock dela.

Funcionalidade: Worker do financeiro consome o Evolution e responde
  Como o usuário do WhatsApp
  Quero mandar uma mensagem e receber a resposta do bot
  Para registrar e acompanhar meus gastos conversando

  Cenário: Uma despesa por mensagem vira comando e resposta
    Dado que a finance-api vai responder "written" com entity_id "tx-1"
    Quando chega a mensagem "Gastei 45 no almoço hoje" do telefone "5521981962914"
    Então a finance-api recebeu o comando "finance.transaction.register"
    E o worker enviou a resposta para "5521981962914"
    E a resposta menciona "45"

  Cenário: O eco da própria resposta não vira comando
    Dado que a finance-api vai responder "written" com entity_id "tx-1"
    Quando chega uma mensagem fromMe "Registrei R$ 45,00"
    Então nenhum comando foi enviado à finance-api

  Cenário: Evento que não é de mensagem é ignorado
    Dado que a finance-api vai responder "written" com entity_id "tx-1"
    Quando chega um evento "connection.update"
    Então nenhum comando foi enviado à finance-api

  Cenário: Mensagem sem texto é ignorada sem quebrar o loop
    Dado que a finance-api vai responder "written" com entity_id "tx-1"
    Quando chega a mensagem sem texto do telefone "5521981962914"
    Então nenhum comando foi enviado à finance-api

  Cenário: Mensagem repetida (mesmo id) tem efeito único
    Dado que a finance-api vai responder "written" com entity_id "tx-1"
    Quando chega a mesma mensagem "Gastei 45 no almoço" do telefone "5521981962914" duas vezes
    Então a finance-api recebeu o comando "finance.transaction.register" uma vez

  Cenário: Falha no envio da resposta não derruba o consumo
    Dado que a finance-api vai responder "written" com entity_id "tx-1"
    E que o gateway do WhatsApp vai falhar no envio
    Quando chega a mensagem "Gastei 45 no almoço hoje" do telefone "5521981962914"
    Então a finance-api recebeu o comando "finance.transaction.register"

  Cenário: "Como estão meus gastos" vira uma leitura e responde com o resumo
    Dado que a finance-api vai responder "written" com entity_id "tx-1"
    E que a leitura "finance.query.monthlyDashboard" devolve o resumo do mês
    Quando chega a mensagem "Como estão meus gastos este mês?" do telefone "5521981962914"
    Então a finance-api recebeu a leitura "finance.query.monthlyDashboard"
    E nenhum comando foi enviado à finance-api
    E o worker enviou a resposta para "5521981962914"
    E a resposta menciona "Resumo de 2026-10"

  Cenário: Pedir gráfico envia um PNG pelo gateway
    Dado que a finance-api vai responder "written" com entity_id "tx-1"
    E que a leitura "finance.query.cashFlowHistory" devolve o fluxo de caixa
    Quando chega a mensagem "me manda o gráfico dos gastos" do telefone "5521981962914"
    Então a finance-api recebeu a leitura "finance.query.cashFlowHistory"
    E o worker enviou uma mídia para "5521981962914"
    E a mídia é um PNG
