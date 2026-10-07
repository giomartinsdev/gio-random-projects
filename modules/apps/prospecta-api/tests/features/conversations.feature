# language: pt
# US3 — Conversas & Mensagens (contrato:
# specs/004-prospecta/contracts/prospecta-api.md).
#
# Fixa o contrato da BFF/ACL para o inbox:
#   - GET /conversations é a lista paginada do inbox;
#   - GET /conversations/{id} devolve a thread completa; id inexistente é 404;
#   - POST /messages valida e publica DraftMessage (202); sem content é 422;
#   - POST /messages/{id}/approve só aceita mensagem em 'drafted' (senão 409),
#     sempre sem escrita parcial.

Funcionalidade: Conversas e mensagens na prospecta-api
  Como o front do Prospecta
  Quero ler o inbox, redigir e aprovar abordagens
  Para que o humano aprove cada envio sem esta API tocar no banco

  Cenário: Listar conversas devolve a página com items
    Dado que eu tenho uma API com X-API-Key configurada
    E a conversa de id "dddddddd-0000-0000-0000-000000000001" existe no par de domínio
    Quando eu faço GET "/conversations"
    Então a resposta tem status HTTP 200
    E o corpo traz a lista "items" com 1 itens
    E o item 1 do corpo tem "id" igual a "dddddddd-0000-0000-0000-000000000001"

  Cenário: Ler conversa existente devolve a thread completa
    Dado que eu tenho uma API com X-API-Key configurada
    E a conversa de id "dddddddd-0000-0000-0000-000000000001" existe no par de domínio
    Quando eu faço GET "/conversations/dddddddd-0000-0000-0000-000000000001"
    Então a resposta tem status HTTP 200
    E o corpo traz a lista "messages" com 2 itens

  Cenário: Ler conversa inexistente devolve 404
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço GET "/conversations/00000000-0000-0000-0000-000000000000"
    Então a resposta tem status HTTP 404

  Cenário: Redigir mensagem publica DraftMessage e responde 202
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço POST "/messages" com:
      """
      {"lead_id":"bbbbbbbb-0000-0000-0000-000000000001","channel":"email","content":"Olá, tudo bem?"}
      """
    Então a resposta tem status HTTP 202
    E o comando "DraftMessage" foi publicado no par de domínio
    E o comando "DraftMessage" publicado tem "lead_id" igual a "bbbbbbbb-0000-0000-0000-000000000001"

  Cenário: Redigir mensagem sem conteúdo é recusado sem escrita parcial
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço POST "/messages" com:
      """
      {"lead_id":"bbbbbbbb-0000-0000-0000-000000000001","channel":"email","content":"   "}
      """
    Então a resposta tem status HTTP 422
    E o comando "DraftMessage" NÃO foi publicado no par de domínio

  Cenário: Sem X-API-Key a redação de mensagem é recusada sem repasse
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço POST "/messages" sem o cabeçalho X-API-Key com:
      """
      {"lead_id":"bbbbbbbb-0000-0000-0000-000000000001","channel":"email","content":"Olá"}
      """
    Então a resposta tem status HTTP 401
    E o comando "DraftMessage" NÃO foi publicado no par de domínio

  Cenário: Aprovar mensagem em drafted publica ApproveMessage
    Dado que eu tenho uma API com X-API-Key configurada
    E a mensagem de id "eeeeeeee-0000-0000-0000-000000000001" existe com status "drafted" no par de domínio
    Quando eu faço POST "/messages/eeeeeeee-0000-0000-0000-000000000001/approve" sem corpo
    Então a resposta tem status HTTP 202
    E o comando "ApproveMessage" foi publicado no par de domínio
    E o comando "ApproveMessage" publicado tem "message_id" igual a "eeeeeeee-0000-0000-0000-000000000001"

  Cenário: Aprovar mensagem já enviada devolve 409 sem escrita parcial
    Dado que eu tenho uma API com X-API-Key configurada
    E a mensagem de id "eeeeeeee-0000-0000-0000-000000000002" existe com status "sent" no par de domínio
    Quando eu faço POST "/messages/eeeeeeee-0000-0000-0000-000000000002/approve" sem corpo
    Então a resposta tem status HTTP 409
    E o comando "ApproveMessage" NÃO foi publicado no par de domínio

  Cenário: Aprovar mensagem inexistente devolve 404
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço POST "/messages/00000000-0000-0000-0000-000000000000/approve" sem corpo
    Então a resposta tem status HTTP 404
    E o comando "ApproveMessage" NÃO foi publicado no par de domínio
