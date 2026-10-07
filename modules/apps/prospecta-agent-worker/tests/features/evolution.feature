# language: pt
# O worker recebe as respostas do WhatsApp pela Evolution API: a Evolution
# publica todo evento no exchange topic `evolution` (fila global
# `evolution.messages.upsert`, stack `compute`) e o worker o traduz num evento de
# domínio `ReplyReceived`.
#
# Estes cenários fixam o PARSE do payload Evolution v2.3.7 (contrato §Parse):
#   - `message.conversation` (texto simples) vira ReplyReceived;
#   - `message.extendedTextMessage.text` (texto com contexto) é a borda
#     equivalente -- as duas formas precisam funcionar, senão metade das
#     respostas some;
#   - `fromMe=true` é o eco da própria abordagem do bot: ignorado, senão o
#     agente conversaria consigo mesmo em loop;
#   - `@g.us` é grupo, não é número: recusado;
#   - um telefone sem lead conhecido não tem a quem pertencer: ignorado.
#
# O Evolution é um publicador AMQP real (o teste publica na fila como ele faria)
# e a prospecta-api é um stub HTTP real (um container): o que se testa é a
# travessia de rede inteira, não um dublê dela.

Funcionalidade: O worker traduz respostas do Evolution em ReplyReceived
  Como o núcleo agêntico do Prospecta
  Quero consumir as respostas do cliente que chegam pelo RabbitMQ
  Para alimentar a conversa (inbox) sem inventar um broker próprio

  Cenário: Uma resposta de texto (conversation) vira ReplyReceived
    Dado um lead conhecido para o telefone "5521981962914"
    Quando o Evolution publica a mensagem "Tenho interesse" do telefone "5521981962914"
    Então o worker publicou o evento "ReplyReceived" para o telefone "5521981962914"

  Cenário: Uma resposta em extendedTextMessage.text também vira ReplyReceived
    Dado um lead conhecido para o telefone "5521981962914"
    Quando o Evolution publica a mensagem estendida "Quero uma demonstração" do telefone "5521981962914"
    Então o worker publicou o evento "ReplyReceived" para o telefone "5521981962914"

  Cenário: O eco da própria mensagem (fromMe=true) é ignorado
    Dado um lead conhecido para o telefone "5521981962914"
    Quando o Evolution publica uma mensagem fromMe do telefone "5521981962914"
    Então o worker não publicou nenhum evento

  Cenário: Uma mensagem de grupo (@g.us) é recusada
    Quando o Evolution publica uma mensagem do grupo "1234567890"
    Então o worker não publicou nenhum evento

  Cenário: Uma mensagem de um número sem lead conhecido é ignorada
    Quando o Evolution publica a mensagem "Oi, tudo bem?" do telefone "5511999999999"
    Então o worker não publicou nenhum evento
