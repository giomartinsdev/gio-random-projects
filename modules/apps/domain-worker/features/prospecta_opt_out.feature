# language: pt
# Guardrail LGPD: o comando SetOptOut (specs/004-prospecta).
#
# Registra que um lead pediu para não ser contatado. O núcleo agêntico consulta
# esta tabela ANTES de todo envio (o GET /opt-outs/{lead_id}); sem a linha ele
# pode mandar, com ela nunca. Idempotente por (tenant_id, lead_id).
# Roda contra Postgres REAL (testcontainers, o schema.sql do worker).

Funcionalidade: Opt-out de lead (SetOptOut) no domain-worker
  Como dono da persistência do Prospecta
  Quero registrar o opt-out de um lead de forma idempotente
  Para que o guardrail LGPD nunca deixe o agente contatar quem pediu para sair

  Cenário: SetOptOut registra o pedido e levanta o evento
    Dado um banco de domínio limpo
    Quando o worker processa "SetOptOut" para o lead do tenant "11111111-1111-1111-1111-111111111111" com motivo "pedido do titular"
    Então o comando termina sem erro
    E existem 1 opt-outs do tenant "11111111-1111-1111-1111-111111111111"
    E o opt-out do tenant "11111111-1111-1111-1111-111111111111" tem motivo "pedido do titular"
    E o evento "OptOutSet" foi levantado

  Cenário: reentrega do mesmo pedido grava uma linha só e não republica
    Dado um banco de domínio limpo
    Quando o worker processa "SetOptOut" para o lead do tenant "22222222-2222-2222-2222-222222222222" com motivo "spam"
    E o worker processa "SetOptOut" de novo para o MESMO lead do tenant "22222222-2222-2222-2222-222222222222"
    Então existem 1 opt-outs do tenant "22222222-2222-2222-2222-222222222222"
    E houve apenas 1 evento "OptOutSet"

  Cenário: SetOptOut sem lead_id é recusado sem escrita
    Dado um banco de domínio limpo
    Quando o worker processa "SetOptOut" sem lead para o tenant "33333333-3333-3333-3333-333333333333"
    Então o comando termina com erro
    E existem 0 opt-outs do tenant "33333333-3333-3333-3333-333333333333"
    E há 1 linhas de auditoria falha para "SetOptOut"
