# language: pt
# Primeiro vertical slice do Prospecta (specs/004-prospecta): o agregado
# Company + ICP no domain-worker. O worker é o ÚNICO escritor das tabelas
# prospecta_*; a prospecta-api (ACL) só publica o comando.
#
# Estes cenários rodam contra um Postgres REAL (testcontainers) e cobrem os
# três tipos exigidos: positivo (aplica + audita), negativo (payload inválido →
# erro, sem escrita parcial) e edge (reentrega idempotente, empresa
# inexistente). O evento é capturado do próprio handler -- não há broker no
# teste; o que se prova é a decisão de levantar (ou não) o evento.

Funcionalidade: Agregado Company + ICP (Prospecta) no domain-worker
  Como dono da persistência do Prospecta
  Quero aplicar CreateCompany/DefineICP de forma idempotente e auditada
  Para que a reentrega at-least-once não duplique nem perca uma escrita

  Cenário: CreateCompany aplica e audita
    Dado um banco de domínio limpo
    Quando o worker processa "CreateCompany" para o tenant "11111111-1111-1111-1111-111111111111" com nome "ACME Ltda" e site "acme.com"
    Então o comando termina sem erro
    E existem 1 empresas do tenant "11111111-1111-1111-1111-111111111111"
    E a empresa do tenant "11111111-1111-1111-1111-111111111111" tem nome "ACME Ltda"
    E o evento "CompanyRegistered" foi levantado
    E há 1 linhas de auditoria ok para "CreateCompany"

  Cenário: DefineICP aplica para uma empresa existente
    Dado um banco de domínio limpo
    E uma empresa do tenant "22222222-2222-2222-2222-222222222222" cadastrada como "FrotaX"
    Quando o worker processa "DefineICP" para essa empresa com definição "transportadoras com mais de 50 caminhões" e sinais "expansão de frota,novo CD"
    Então o comando termina sem erro
    E existem 1 ICPs do tenant "22222222-2222-2222-2222-222222222222"
    E o ICP do tenant "22222222-2222-2222-2222-222222222222" tem definição "transportadoras com mais de 50 caminhões"
    E o evento "ICPDefined" foi levantado

  Cenário: payload inválido não escreve nada e falha
    Dado um banco de domínio limpo
    Quando o worker processa "CreateCompany" sem nome para o tenant "33333333-3333-3333-3333-333333333333"
    Então o comando termina com erro
    E existem 0 empresas do tenant "33333333-3333-3333-3333-333333333333"
    E há 1 linhas de auditoria falha para "CreateCompany"

  Cenário: reentrega do mesmo comando grava uma linha só e não republica
    Dado um banco de domínio limpo
    Quando o worker processa "CreateCompany" para o tenant "44444444-4444-4444-4444-444444444444" com nome "Repetida" e site "rep.com"
    E o worker processa o MESMO comando de novo
    Então existem 1 empresas do tenant "44444444-4444-4444-4444-444444444444"
    E houve apenas 1 evento "CompanyRegistered"

  Cenário: DefineICP para empresa inexistente falha sem escrita
    Dado um banco de domínio limpo
    Quando o worker processa "DefineICP" para uma empresa inexistente do tenant "55555555-5555-5555-5555-555555555555"
    Então o comando termina com erro
    E existem 0 ICPs do tenant "55555555-5555-5555-5555-555555555555"
