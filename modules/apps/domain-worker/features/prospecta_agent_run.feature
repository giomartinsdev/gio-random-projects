# language: pt
# Agregado AgentRun — o comando UpdateAgentRun (specs/004-prospecta).
#
# O run é ABERTO pelo RequestProspect (o payload carrega o run_id); o núcleo
# agêntico o FECHA por aqui. O worker é o único escritor de prospecta_agent_run.
# Roda contra Postgres REAL (testcontainers, o schema.sql do worker) e usa o
# process() de produção; cobre positivo, negativo e edge (reentrega idempotente
# que não regride um run terminal).

Funcionalidade: Run de agente (UpdateAgentRun) no domain-worker
  Como dono da persistência do Prospecta
  Quero fechar um run com state e metrics de forma idempotente
  Para que a reentrega at-least-once não regride um run terminal

  Cenário: UpdateAgentRun fecha o run com state e metrics
    Dado um banco de domínio limpo
    E um run do tenant "11111111-1111-1111-1111-111111111111" do agente "prospector" em "running"
    Quando o worker processa "UpdateAgentRun" para esse run com state "done" e metrics "found=12"
    Então o comando termina sem erro
    E o run do tenant "11111111-1111-1111-1111-111111111111" tem state "done"
    E o run do tenant "11111111-1111-1111-1111-111111111111" tem metrics "found" igual a 12
    E o run do tenant "11111111-1111-1111-1111-111111111111" tem ended_at preenchido
    E o evento "AgentRunUpdated" foi levantado

  Cenário: reentrega do mesmo comando não regride um run terminal
    Dado um banco de domínio limpo
    E um run do tenant "11111111-1111-1111-1111-111111111111" do agente "prospector" em "running"
    Quando o worker processa "UpdateAgentRun" para esse run com state "done" e metrics "found=12"
    E o worker processa o MESMO comando de novo
    Então o run do tenant "11111111-1111-1111-1111-111111111111" tem state "done"
    E houve apenas 1 evento "AgentRunUpdated"

  Cenário: UpdateAgentRun de um run inexistente falha sem escrita
    Dado um banco de domínio limpo
    Quando o worker processa "UpdateAgentRun" para um run inexistente do tenant "55555555-5555-5555-5555-555555555555"
    Então o comando termina com erro
    E há 1 linhas de auditoria falha para "UpdateAgentRun"

  Cenário: state fora de running|done|failed é recusado sem tocar o run
    Dado um banco de domínio limpo
    E um run do tenant "66666666-6666-6666-6666-666666666666" do agente "prospector" em "running"
    Quando o worker processa "UpdateAgentRun" para esse run com state "banana" e metrics ""
    Então o comando termina com erro
    E o run do tenant "66666666-6666-6666-6666-666666666666" tem state "running"
