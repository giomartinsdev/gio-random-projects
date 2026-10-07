# language: pt
# Agregado User do Prospecta (autenticação e-mail+senha) no domain-worker.
#
# O worker é o ÚNICO escritor de prospecta_user; a leitura cross-tenant por
# e-mail vive no domain-api (GET /users/by-email/{email}) e NÃO pertence aqui.
# O password_hash já chega pronto (bcrypt) no payload do comando — o worker só
# grava, nunca vê a senha em claro nem faz hashing.
#
# Estes cenários rodam contra um Postgres REAL (testcontainers) e cobrem os três
# tipos exigidos: positivo (aplica + audita + levanta UserRegistered), negativo
# (email/senha/tenant inválidos → erro, sem escrita parcial) e edge (e-mail
# duplicado falha de forma limpa; reentrega idempotente do MESMO comando).

Funcionalidade: Agregado User (Prospecta) no domain-worker
  Como dono da persistência do Prospecta
  Quero aplicar CreateUser de forma idempotente e auditada
  Para que o login por e-mail+senha funcione sobre um usuário único por e-mail

  Cenário: CreateUser aplica, audita e levanta UserRegistered
    Dado um banco de domínio limpo
    Quando o worker processa "CreateUser" para o tenant "11111111-1111-1111-1111-111111111111" com e-mail "ana@acme.com" e senha "hash-bcrypt-1"
    Então o comando termina sem erro
    E existem 1 usuários do tenant "11111111-1111-1111-1111-111111111111"
    E o usuário "ana@acme.com" tem role "admin"
    E o evento "UserRegistered" foi levantado
    E há 1 linhas de auditoria ok para "CreateUser"

  Cenário: e-mail duplicado falha de forma limpa e não duplica a linha
    Dado um banco de domínio limpo
    E um usuário do tenant "22222222-2222-2222-2222-222222222222" com e-mail "dup@acme.com"
    Quando o worker processa "CreateUser" para o tenant "22222222-2222-2222-2222-222222222222" com e-mail "DUP@acme.com" e senha "outro-hash"
    Então o comando termina com erro
    E existem 1 usuários do tenant "22222222-2222-2222-2222-222222222222"

  Cenário: e-mail vazio é recusado sem escrita
    Dado um banco de domínio limpo
    Quando o worker processa "CreateUser" sem e-mail para o tenant "33333333-3333-3333-3333-333333333333"
    Então o comando termina com erro
    E existem 0 usuários do tenant "33333333-3333-3333-3333-333333333333"

  Cenário: e-mail com formato inválido é recusado sem escrita
    Dado um banco de domínio limpo
    Quando o worker processa "CreateUser" com e-mail inválido "sem-arroba" para o tenant "44444444-4444-4444-4444-444444444444"
    Então o comando termina com erro
    E existem 0 usuários do tenant "44444444-4444-4444-4444-444444444444"

  Cenário: sem password_hash é recusado sem escrita
    Dado um banco de domínio limpo
    Quando o worker processa "CreateUser" sem senha para o tenant "55555555-5555-5555-5555-555555555555"
    Então o comando termina com erro
    E existem 0 usuários do tenant "55555555-5555-5555-5555-555555555555"

  Cenário: reentrega do mesmo comando grava uma linha só e não republica
    Dado um banco de domínio limpo
    Quando o worker processa "CreateUser" para o tenant "66666666-6666-6666-6666-666666666666" com e-mail "repetida@acme.com" e senha "hash-bcrypt-1"
    E o worker processa o MESMO comando CreateUser de novo
    Então existem 1 usuários do tenant "66666666-6666-6666-6666-666666666666"
    E houve apenas 1 evento "UserRegistered"
