# language: pt
# US1 — Empresa + ICP (contrato: specs/004-prospecta/contracts/prospecta-api.md).
#
# O que estes cenários fixam é o contrato da BFF/ACL, não só o caminho feliz:
#   - a leitura (GET) passa pelo par de domínio e devolve a projeção;
#   - a escrita (POST) vira comando {action, payload} para o par de domínio e
#     responde 202 sem tocar em banco nenhum (regra de isolamento §1.1);
#   - sem X-API-Key não há repasse (401); payload inválido morre AQUI (422),
#     antes de publicar -- nunca há escrita parcial;
#   - id inexistente no par de domínio vira 404 (não 500).
#
# Roda contra um "par de domínio" FALSO em container (golang:alpine) que
# implementa o contrato documentado -- GET /companies/{id} e POST /commands --
# e registra os comandos recebidos, para o cenário poder provar o que a API
# publicou e o que NÃO publicou.

Funcionalidade: Empresa e ICP na prospecta-api
  Como o front do Prospecta
  Quero cadastrar a empresa, ler a projeção e definir o ICP
  Para que o núcleo agêntico tenha contexto sem esta API tocar no banco

  Cenário: Cadastrar empresa publica CreateCompany e responde 202
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço POST "/companies" com:
      """
      {"name":"Northwind Log","site":"northwindlog.com.br","description":"Software de gestão de frotas e roteirização."}
      """
    Então a resposta tem status HTTP 202
    E a resposta traz um "id" não vazio
    E a resposta traz "status" igual a "accepted"
    E o comando "CreateCompany" foi publicado no par de domínio

  Cenário: Sem X-API-Key a escrita é recusada sem repasse
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço POST "/companies" sem o cabeçalho X-API-Key com:
      """
      {"name":"Northwind Log"}
      """
    Então a resposta tem status HTTP 401
    E o comando "CreateCompany" NÃO foi publicado no par de domínio

  Cenário: Payload de empresa inválido é recusado sem escrita parcial
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço POST "/companies" com:
      """
      {"name":"   ","site":"northwindlog.com.br"}
      """
    Então a resposta tem status HTTP 422
    E o comando "CreateCompany" NÃO foi publicado no par de domínio

  Cenário: Ler uma empresa existente devolve a projeção com o ICP
    Dado que eu tenho uma API com X-API-Key configurada
    E a empresa de id "11111111-1111-1111-1111-111111111111" existe no par de domínio
    Quando eu faço GET "/companies/11111111-1111-1111-1111-111111111111"
    Então a resposta tem status HTTP 200
    E o corpo traz "name" igual a "Northwind Log"
    E o corpo traz o ICP com "definition" não vazio

  Cenário: Ler uma empresa inexistente devolve 404
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço GET "/companies/00000000-0000-0000-0000-000000000000"
    Então a resposta tem status HTTP 404

  Cenário: Definir o ICP publica DefineICP com o company_id do caminho
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço POST "/companies/11111111-1111-1111-1111-111111111111/icp" com:
      """
      {"definition":"Logística B2B, 50–500 funcionários, Sudeste, expandindo frota.","signals":["abertura de novo CD","expansão de frota"]}
      """
    Então a resposta tem status HTTP 202
    E a resposta traz um "id" não vazio
    E o comando "DefineICP" foi publicado no par de domínio
    E o comando "DefineICP" publicado tem "company_id" igual a "11111111-1111-1111-1111-111111111111"

  Cenário: ICP com definição vazia é recusado sem escrita parcial
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço POST "/companies/11111111-1111-1111-1111-111111111111/icp" com:
      """
      {"definition":"   ","signals":[]}
      """
    Então a resposta tem status HTTP 422
    E o comando "DefineICP" NÃO foi publicado no par de domínio
