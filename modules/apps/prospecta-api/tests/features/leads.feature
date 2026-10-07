# language: pt
# US2 — Leads (contrato: specs/004-prospecta/contracts/prospecta-api.md).
#
# Fixa o contrato da BFF/ACL para leads:
#   - GET /leads é paginado e filtra por campaign_id, status e fit_min;
#   - GET /leads/{id} devolve o detalhe; id inexistente é 404;
#   - POST /leads/{id}/qualify publica QualifyLead (202); fit fora de 0..100
#     (ou ausente) é 422, sem escrita parcial.

Funcionalidade: Leads na prospecta-api
  Como o front do Prospecta
  Quero listar, ler e qualificar leads
  Para operar o pipeline sem esta API tocar no banco

  Cenário: Listar leads devolve a página com items e next
    Dado que eu tenho uma API com X-API-Key configurada
    E o lead de id "bbbbbbbb-0000-0000-0000-000000000001" existe com fit 80 e status "qualified" na campanha "ccc" no par de domínio
    E o lead de id "bbbbbbbb-0000-0000-0000-000000000002" existe com fit 40 e status "discovered" na campanha "ccc" no par de domínio
    Quando eu faço GET "/leads"
    Então a resposta tem status HTTP 200
    E o corpo traz a lista "items" com 2 itens

  Cenário: Filtrar leads por fit_min devolve só os que atingem o mínimo
    Dado que eu tenho uma API com X-API-Key configurada
    E o lead de id "bbbbbbbb-0000-0000-0000-000000000001" existe com fit 80 e status "qualified" na campanha "ccc" no par de domínio
    E o lead de id "bbbbbbbb-0000-0000-0000-000000000002" existe com fit 40 e status "discovered" na campanha "ccc" no par de domínio
    Quando eu faço GET "/leads?campaign_id=ccc&fit_min=70"
    Então a resposta tem status HTTP 200
    E o corpo traz a lista "items" com 1 itens
    E o item 1 do corpo tem "id" igual a "bbbbbbbb-0000-0000-0000-000000000001"

  Cenário: Filtrar leads por status devolve só os do estado
    Dado que eu tenho uma API com X-API-Key configurada
    E o lead de id "bbbbbbbb-0000-0000-0000-000000000001" existe com fit 80 e status "qualified" na campanha "ccc" no par de domínio
    E o lead de id "bbbbbbbb-0000-0000-0000-000000000002" existe com fit 40 e status "discovered" na campanha "ccc" no par de domínio
    Quando eu faço GET "/leads?status=discovered"
    Então a resposta tem status HTTP 200
    E o corpo traz a lista "items" com 1 itens
    E o item 1 do corpo tem "id" igual a "bbbbbbbb-0000-0000-0000-000000000002"

  Cenário: Listar leads com limit devolve a página com next
    Dado que eu tenho uma API com X-API-Key configurada
    E o lead de id "bbbbbbbb-0000-0000-0000-000000000001" existe com fit 80 e status "qualified" na campanha "ccc" no par de domínio
    E o lead de id "bbbbbbbb-0000-0000-0000-000000000002" existe com fit 40 e status "discovered" na campanha "ccc" no par de domínio
    Quando eu faço GET "/leads?limit=1"
    Então a resposta tem status HTTP 200
    E o corpo traz a lista "items" com 1 itens
    E a resposta traz um "next" não vazio

  Cenário: Ler lead existente devolve o detalhe
    Dado que eu tenho uma API com X-API-Key configurada
    E o lead de id "bbbbbbbb-0000-0000-0000-000000000001" existe com fit 80 e status "qualified" na campanha "ccc" no par de domínio
    Quando eu faço GET "/leads/bbbbbbbb-0000-0000-0000-000000000001"
    Então a resposta tem status HTTP 200
    E o corpo traz "company_name" igual a "Northwind Log"

  Cenário: Ler lead inexistente devolve 404
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço GET "/leads/00000000-0000-0000-0000-000000000000"
    Então a resposta tem status HTTP 404

  Cenário: Qualificar lead publica QualifyLead com o fit do corpo
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço POST "/leads/bbbbbbbb-0000-0000-0000-000000000001/qualify" com:
      """
      {"fit":90}
      """
    Então a resposta tem status HTTP 202
    E o comando "QualifyLead" foi publicado no par de domínio
    E o comando "QualifyLead" publicado tem "lead_id" igual a "bbbbbbbb-0000-0000-0000-000000000001"
    E o comando "QualifyLead" publicado tem "fit" igual a 90

  Cenário: Qualificar com fit acima de 100 é recusado sem escrita parcial
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço POST "/leads/bbbbbbbb-0000-0000-0000-000000000001/qualify" com:
      """
      {"fit":101}
      """
    Então a resposta tem status HTTP 422
    E o comando "QualifyLead" NÃO foi publicado no par de domínio

  Cenário: Qualificar com fit negativo é recusado sem escrita parcial
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço POST "/leads/bbbbbbbb-0000-0000-0000-000000000001/qualify" com:
      """
      {"fit":-1}
      """
    Então a resposta tem status HTTP 422
    E o comando "QualifyLead" NÃO foi publicado no par de domínio
