# language: pt
# US2 — Campanhas (contrato: specs/004-prospecta/contracts/prospecta-api.md).
#
# Fixa o contrato da BFF/ACL para campanhas:
#   - POST /campaigns valida e publica CreateCampaign, responde 202;
#   - GET /campaigns é paginado (items + next) e passa pelo par de domínio;
#   - GET /campaigns/{id} devolve a projeção; id inexistente é 404;
#   - POST /campaigns/{id}/start publica StartCampaign E RequestProspect em 202,
#     mas recusa (422) campanha sem ICP -- sem escrita parcial.

Funcionalidade: Campanhas na prospecta-api
  Como o front do Prospecta
  Quero criar, listar e disparar campanhas
  Para que o núcleo agêntico prospecte sem esta API tocar no banco

  Cenário: Criar campanha publica CreateCampaign e responde 202
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço POST "/campaigns" com:
      """
      {"company_id":"11111111-1111-1111-1111-111111111111","name":"Logística Sudeste","channels":["email","whatsapp"]}
      """
    Então a resposta tem status HTTP 202
    E a resposta traz um "id" não vazio
    E a resposta traz "status" igual a "accepted"
    E o comando "CreateCampaign" foi publicado no par de domínio
    E o comando "CreateCampaign" publicado tem "company_id" igual a "11111111-1111-1111-1111-111111111111"

  Cenário: Criar campanha sem company_id é recusado sem escrita parcial
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço POST "/campaigns" com:
      """
      {"company_id":"   ","name":"Sem empresa"}
      """
    Então a resposta tem status HTTP 422
    E o comando "CreateCampaign" NÃO foi publicado no par de domínio

  Cenário: Criar campanha sem nome é recusado sem escrita parcial
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço POST "/campaigns" com:
      """
      {"company_id":"11111111-1111-1111-1111-111111111111","name":"  "}
      """
    Então a resposta tem status HTTP 422
    E o comando "CreateCampaign" NÃO foi publicado no par de domínio

  Cenário: Sem X-API-Key a criação de campanha é recusada sem repasse
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço POST "/campaigns" sem o cabeçalho X-API-Key com:
      """
      {"company_id":"11111111-1111-1111-1111-111111111111","name":"Logística Sudeste"}
      """
    Então a resposta tem status HTTP 401
    E o comando "CreateCampaign" NÃO foi publicado no par de domínio

  Cenário: Listar campanhas devolve a página com items e next
    Dado que eu tenho uma API com X-API-Key configurada
    E a campanha de id "aaaaaaaa-0000-0000-0000-000000000001" existe no par de domínio
    E a campanha de id "aaaaaaaa-0000-0000-0000-000000000002" existe no par de domínio
    Quando eu faço GET "/campaigns"
    Então a resposta tem status HTTP 200
    E o corpo traz a lista "items" com 2 itens

  Cenário: Listar campanhas com limit devolve a página com next
    Dado que eu tenho uma API com X-API-Key configurada
    E a campanha de id "aaaaaaaa-0000-0000-0000-000000000001" existe no par de domínio
    E a campanha de id "aaaaaaaa-0000-0000-0000-000000000002" existe no par de domínio
    Quando eu faço GET "/campaigns?limit=1"
    Então a resposta tem status HTTP 200
    E o corpo traz a lista "items" com 1 itens
    E a resposta traz um "next" não vazio

  Cenário: Ler campanha inexistente devolve 404
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço GET "/campaigns/00000000-0000-0000-0000-000000000000"
    Então a resposta tem status HTTP 404

  Cenário: Iniciar campanha com ICP publica StartCampaign e RequestProspect
    Dado que eu tenho uma API com X-API-Key configurada
    E a campanha de id "aaaaaaaa-0000-0000-0000-000000000001" existe com ICP no par de domínio
    Quando eu faço POST "/campaigns/aaaaaaaa-0000-0000-0000-000000000001/start" sem corpo
    Então a resposta tem status HTTP 202
    E o comando "StartCampaign" foi publicado no par de domínio
    E o comando "RequestProspect" foi publicado no par de domínio
    E o comando "StartCampaign" publicado tem "campaign_id" igual a "aaaaaaaa-0000-0000-0000-000000000001"

  Cenário: Iniciar campanha sem ICP é recusado sem escrita parcial
    Dado que eu tenho uma API com X-API-Key configurada
    E a campanha de id "aaaaaaaa-0000-0000-0000-000000000003" existe sem ICP no par de domínio
    Quando eu faço POST "/campaigns/aaaaaaaa-0000-0000-0000-000000000003/start" sem corpo
    Então a resposta tem status HTTP 422
    E o comando "StartCampaign" NÃO foi publicado no par de domínio
    E o comando "RequestProspect" NÃO foi publicado no par de domínio
