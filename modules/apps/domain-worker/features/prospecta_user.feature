# language: pt
# Agregado User do Prospecta (autenticação e-mail+senha + Google SSO) no
# domain-worker.
#
# O worker é o ÚNICO escritor de prospecta_user; a leitura cross-tenant por
# e-mail vive no domain-api (GET /users/by-email/{email}) e NÃO pertence aqui.
# O password_hash já chega pronto (bcrypt) no payload do comando — o worker só
# grava, nunca vê a senha em claro nem faz hashing. Um hash VAZIO é válido na
# criação: é a conta só-Google, que define a senha depois por UpdateUserPassword.
#
# Estes cenários rodam contra um Postgres REAL (testcontainers) e cobrem os três
# tipos exigidos: positivo (aplica + audita + levanta UserRegistered), negativo
# (email/tenant inválidos → erro, sem escrita parcial) e edge (e-mail duplicado
# falha de forma limpa; reentrega idempotente do MESMO comando).

Funcionalidade: Agregado User (Prospecta) no domain-worker
  Como dono da persistência do Prospecta
  Quero aplicar CreateUser/UpdateUserPassword de forma idempotente e auditada
  Para que o login por e-mail+senha (e o SSO do Google) funcione sobre um usuário único por e-mail

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

  Cenário: conta criada por Google nasce com password_hash vazio
    Dado um banco de domínio limpo
    Quando o worker processa "CreateUser" sem senha para o tenant "55555555-5555-5555-5555-555555555555"
    Então o comando termina sem erro
    E existem 1 usuários do tenant "55555555-5555-5555-5555-555555555555"
    E o usuário "sem-senha@acme.com" tem password_hash vazio
    E o evento "UserRegistered" foi levantado

  Cenário: reentrega do mesmo comando grava uma linha só e não republica
    Dado um banco de domínio limpo
    Quando o worker processa "CreateUser" para o tenant "66666666-6666-6666-6666-666666666666" com e-mail "repetida@acme.com" e senha "hash-bcrypt-1"
    E o worker processa o MESMO comando CreateUser de novo
    Então existem 1 usuários do tenant "66666666-6666-6666-6666-666666666666"
    E houve apenas 1 evento "UserRegistered"

  Cenário: UpdateUserPassword define a senha de uma conta só-Google
    Dado um banco de domínio limpo
    E um usuário só-Google do tenant "77777777-7777-7777-7777-777777777777" com e-mail "googler@acme.com"
    Quando o worker processa "UpdateUserPassword" para o usuário "googler@acme.com" do tenant "77777777-7777-7777-7777-777777777777" com senha "hash-bcrypt-2"
    Então o comando termina sem erro
    E o usuário "googler@acme.com" tem password_hash "hash-bcrypt-2"
    E o evento "UserPasswordChanged" foi levantado
    E há 1 linhas de auditoria ok para "UpdateUserPassword"

  Cenário: UpdateUserPassword com usuário inexistente falha sem escrever
    Dado um banco de domínio limpo
    Quando o worker processa "UpdateUserPassword" para um usuário inexistente do tenant "88888888-8888-8888-8888-888888888888" com senha "hash-bcrypt-2"
    Então o comando termina com erro
    E existem 0 usuários do tenant "88888888-8888-8888-8888-888888888888"

  Cenário: reentrega do UpdateUserPassword grava uma vez e não republica
    Dado um banco de domínio limpo
    E um usuário só-Google do tenant "99999999-9999-9999-9999-999999999999" com e-mail "idem-pw@acme.com"
    Quando o worker processa "UpdateUserPassword" para o usuário "idem-pw@acme.com" do tenant "99999999-9999-9999-9999-999999999999" com senha "hash-bcrypt-2"
    E o worker processa o MESMO comando UpdateUserPassword de novo
    Então o usuário "idem-pw@acme.com" tem password_hash "hash-bcrypt-2"
    E houve apenas 1 evento "UserPasswordChanged"
