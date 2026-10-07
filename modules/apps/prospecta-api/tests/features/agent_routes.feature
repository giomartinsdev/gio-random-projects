# language: pt
# Rotas que o prospecta-agent-worker chama (specs/004-prospecta,
# contracts/prospecta-agent-worker.md e prospecta-api.md).
#
# O núcleo agêntico (Python, sem banco) fala com esta BFF/ACL: escreve por
# comandos (202), lê projeções (200/404). A BFF valida, publica o comando no
# envelope {action, payload} e responde 202; nunca toca no Postgres. Toda rota
# vive atrás da identidade (sessão OU X-API-Key) e é scoped no tenant resolvido.
#
# Roda contra o fake-domain-pair REAL em container (tests/fake-domain-pair) e
# sobe o router de produção via httptest, no mesmo molde das demais features.
#
# NOTA: NÃO existe POST /agent/runs. O run já é criado pelo RequestProspect e
# vem no evento ProspectRequested com o run_id; o agente só o ATUALIZA por
# POST /agent/runs/{id}.

Funcionalidade: Rotas do agente na prospecta-api
  Como o prospecta-agent-worker
  Quero publicar leads/runs e ler opt-out e lead por telefone
  Para operar a prospecção sem tocar no banco

  # --- UpsertLead -----------------------------------------------------------
  Cenário: Criar lead publica UpsertLead na ACL
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço POST "/leads" com:
      """
      {"campaign_id":"ccc","company_name":"Northwind Log","domain":"northwindlog.com.br","segment":"logística","channel":"whatsapp","source_url":"https://exemplo.com","enriched":{"phone":"5521981962914"}}
      """
    Então a resposta tem status HTTP 202
    E o comando "UpsertLead" foi publicado no par de domínio
    E o comando "UpsertLead" publicado tem "company_name" igual a "Northwind Log"
    E o comando "UpsertLead" publicado tem "domain" igual a "northwindlog.com.br"

  Cenário: Criar lead sem company_name é recusado sem escrita parcial
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço POST "/leads" com:
      """
      {"campaign_id":"ccc","domain":"x.com"}
      """
    Então a resposta tem status HTTP 422
    E o comando "UpsertLead" NÃO foi publicado no par de domínio

  Cenário: Criar lead sem X-API-Key é recusado com 401
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço POST "/leads" sem o cabeçalho X-API-Key com:
      """
      {"campaign_id":"ccc","company_name":"Northwind Log","domain":"x.com"}
      """
    Então a resposta tem status HTTP 401
    E o comando "UpsertLead" NÃO foi publicado no par de domínio

  # --- POST /agent/runs/{id} ------------------------------------------------
  Cenário: Atualizar o run publica UpdateAgentRun com state e metrics
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço POST "/agent/runs/aaaaaaaa-0000-0000-0000-000000000001" com:
      """
      {"state":"done","metrics":{"found":12}}
      """
    Então a resposta tem status HTTP 202
    E o comando "UpdateAgentRun" foi publicado no par de domínio
    E o comando "UpdateAgentRun" publicado tem "run_id" igual a "aaaaaaaa-0000-0000-0000-000000000001"
    E o comando "UpdateAgentRun" publicado tem "state" igual a "done"

  Cenário: state fora de running|done|failed é recusado sem escrita parcial
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço POST "/agent/runs/aaaaaaaa-0000-0000-0000-000000000001" com:
      """
      {"state":"banana"}
      """
    Então a resposta tem status HTTP 422
    E o comando "UpdateAgentRun" NÃO foi publicado no par de domínio

  # --- GET /opt-outs/{lead_id} ---------------------------------------------
  Cenário: Lead com opt-out devolve opted_out verdadeiro
    Dado que eu tenho uma API com X-API-Key configurada
    E o lead "aaaaaaaa-0000-0000-0000-000000000001" está em opt-out no par de domínio
    Quando eu faço GET "/opt-outs/aaaaaaaa-0000-0000-0000-000000000001"
    Então a resposta tem status HTTP 200
    E o corpo traz "opted_out" igual a true

  Cenário: Lead sem opt-out devolve opted_out falso (nunca 404)
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço GET "/opt-outs/aaaaaaaa-0000-0000-0000-000000000099"
    Então a resposta tem status HTTP 200
    E o corpo traz "opted_out" igual a false

  # --- GET /leads/by-phone/{number} ----------------------------------------
  Cenário: Resolver o lead pelo telefone do WhatsApp
    Dado que eu tenho uma API com X-API-Key configurada
    E o lead "aaaaaaaa-0000-0000-0000-000000000001" do tenant "11111111-1111-1111-1111-111111111111" tem telefone "5521981962914" no par de domínio
    Quando eu faço GET "/leads/by-phone/5521981962914"
    Então a resposta tem status HTTP 200
    E o corpo traz "tenant_id" igual a "11111111-1111-1111-1111-111111111111"
    E o corpo traz "lead_id" igual a "aaaaaaaa-0000-0000-0000-000000000001"
    E o corpo traz "thread_key" igual a "wa:5521981962914"

  Cenário: Telefone desconhecido devolve 404
    Dado que eu tenho uma API com X-API-Key configurada
    Quando eu faço GET "/leads/by-phone/5511999999999"
    Então a resposta tem status HTTP 404
