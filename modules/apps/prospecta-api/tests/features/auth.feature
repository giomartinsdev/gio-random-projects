# language: pt
# US5 — Autenticação (e-mail + senha + Google SSO). Contrato congelado:
#   - POST /auth/signup  201 {user,company} + Set-Cookie; 422 inválido; 409 e-mail
#                        duplicado. Efeitos: publica CreateCompany (tenant_id novo)
#                        e CreateUser (company_id = command_id da company,
#                        password_hash = bcrypt, role "owner"). Aceita
#                        google_credential no lugar de password: verifica o token,
#                        usa email/name do Google e grava password_hash vazio
#                        (company continua obrigatório).
#   - POST /auth/login   200 {user,company} + Set-Cookie; 401 senha errada/usuário
#                        inexistente.
#   - POST /auth/google  200 {user,company} + Set-Cookie quando o e-mail existe;
#                        200 {needs_onboarding:true,email,name} SEM cookie quando
#                        não existe; 401 token inválido/expirado/não verificado;
#                        503 sem client ID configurado.
#   - POST /auth/password 204 trocando a senha; 401 senha atual errada; 422 nova
#                        <8. Usuário só-Google (sem senha) DEFINE a senha com
#                        current_password vazio. Sessão obrigatória.
#   - GET  /auth/me      200 {user,company} com sessão; 401 sem.
#   - POST /auth/logout  204 + cookie apagado.
#   - Sem PROSPECTA_SESSION_SECRET, /auth responde 503 (o serviço não cai).
#
# Roda contra o par de domínio FALSO em container, que serve
# GET /users/by-email/{email} e registra CreateUser/CreateCompany/
# UpdateUserPassword, para os cenários provarem o que a API publicou e o que NÃO
# publicou. O verificador do Google é um FAKE (sem rede): a credencial
# "fake:ok:<email>:<nome>" é aceita, "fake:unverified:<email>" recusada e
# qualquer outra inválida.

Funcionalidade: Autenticação por e-mail, senha e Google na prospecta-api
  Como o front do Prospecta
  Quero cadastrar e entrar com e-mail e senha
  Para que o cockpit tenha uma sessão scoped no meu tenant

  Cenário: Cadastro cria empresa e usuário e devolve cookie
    Dado que eu tenho uma API com autenticação configurada
    Quando eu faço o cadastro com:
      """
      {"name":"Ana Souza","email":"ana@northwind.com","password":"segredo-forte","cargo":"CEO","phone":"+5521999999999","company":{"name":"Northwind Log","site":"northwindlog.com.br","description":"Gestão de frotas."}}
      """
    Então a resposta tem status HTTP 201
    E a resposta traz um cookie de sessão
    E o comando "CreateCompany" foi publicado no par de domínio
    E o comando "CreateCompany" publicado tem "tenant_id" não vazio
    E o comando "CreateUser" foi publicado no par de domínio
    E o comando "CreateUser" publicado tem "role" igual a "owner"
    E o comando "CreateUser" publicado tem "password_hash" começando com "$2"
    E o comando "CreateUser" publicado tem "company_id" igual ao id do comando "CreateCompany"
    E a empresa da resposta tem "name" igual a "Northwind Log"

  Cenário: Cadastro com e-mail já existente é recusado sem escrita parcial
    Dado que eu tenho uma API com autenticação configurada
    E o usuário "ana@northwind.com" já existe no par de domínio
    Quando eu faço o cadastro com:
      """
      {"name":"Ana Souza","email":"ana@northwind.com","password":"segredo-forte","company":{"name":"Northwind Log","site":"northwindlog.com.br","description":"x"}}
      """
    Então a resposta tem status HTTP 409
    E o comando "CreateCompany" NÃO foi publicado no par de domínio
    E o comando "CreateUser" NÃO foi publicado no par de domínio

  Cenário: Cadastro com senha fraca é recusado sem escrita parcial
    Dado que eu tenho uma API com autenticação configurada
    Quando eu faço o cadastro com:
      """
      {"name":"Ana Souza","email":"ana@northwind.com","password":"123","company":{"name":"Northwind Log"}}
      """
    Então a resposta tem status HTTP 422
    E o comando "CreateCompany" NÃO foi publicado no par de domínio

  Cenário: Cadastro com e-mail inválido é recusado sem escrita parcial
    Dado que eu tenho uma API com autenticação configurada
    Quando eu faço o cadastro com:
      """
      {"name":"Ana Souza","email":"nao-e-email","password":"segredo-forte","company":{"name":"Northwind Log"}}
      """
    Então a resposta tem status HTTP 422
    E o comando "CreateCompany" NÃO foi publicado no par de domínio

  Cenário: Cadastro sem nome da empresa é recusado sem escrita parcial
    Dado que eu tenho uma API com autenticação configurada
    Quando eu faço o cadastro com:
      """
      {"name":"Ana Souza","email":"ana@northwind.com","password":"segredo-forte","company":{"name":"   "}}
      """
    Então a resposta tem status HTTP 422
    E o comando "CreateCompany" NÃO foi publicado no par de domínio

  Cenário: Login com a senha correta devolve cookie
    Dado que eu tenho uma API com autenticação configurada
    E o usuário "ana@northwind.com" existe com a senha "segredo-forte" no par de domínio
    Quando eu faço o login com:
      """
      {"email":"ana@northwind.com","password":"segredo-forte"}
      """
    Então a resposta tem status HTTP 200
    E a resposta traz um cookie de sessão
    E o usuário da resposta tem "email" igual a "ana@northwind.com"

  Cenário: Login com a senha errada devolve 401
    Dado que eu tenho uma API com autenticação configurada
    E o usuário "ana@northwind.com" existe com a senha "segredo-forte" no par de domínio
    Quando eu faço o login com:
      """
      {"email":"ana@northwind.com","password":"errada"}
      """
    Então a resposta tem status HTTP 401
    E a resposta NÃO traz cookie de sessão

  Cenário: Login de usuário inexistente devolve 401
    Dado que eu tenho uma API com autenticação configurada
    Quando eu faço o login com:
      """
      {"email":"ninguem@northwind.com","password":"segredo-forte"}
      """
    Então a resposta tem status HTTP 401

  Cenário: A sessão emitida identifica o usuário em /auth/me
    Dado que eu tenho uma API com autenticação configurada
    Quando eu faço o cadastro com:
      """
      {"name":"Ana Souza","email":"ana@northwind.com","password":"segredo-forte","company":{"name":"Northwind Log","site":"northwindlog.com.br","description":"x"}}
      """
    E eu faço GET "/auth/me" com o cookie de sessão
    Então a resposta tem status HTTP 200
    E o usuário da resposta tem "email" igual a "ana@northwind.com"
    E a empresa da resposta tem "name" igual a "Northwind Log"

  Cenário: /auth/me sem sessão devolve 401
    Dado que eu tenho uma API com autenticação configurada
    Quando eu faço GET "/auth/me" sem o cookie de sessão
    Então a resposta tem status HTTP 401

  Cenário: Logout apaga o cookie de sessão
    Dado que eu tenho uma API com autenticação configurada
    Quando eu faço o cadastro com:
      """
      {"name":"Ana Souza","email":"ana@northwind.com","password":"segredo-forte","company":{"name":"Northwind Log","site":"northwindlog.com.br","description":"x"}}
      """
    E eu faço POST "/auth/logout" com o cookie de sessão
    Então a resposta tem status HTTP 204
    E a resposta apaga o cookie de sessão

  Cenário: Uma sessão autentica uma rota de negócio e usa o tenant dela
    Dado que eu tenho uma API com autenticação configurada
    Quando eu faço o cadastro com:
      """
      {"name":"Ana Souza","email":"ana@northwind.com","password":"segredo-forte","company":{"name":"Northwind Log","site":"northwindlog.com.br","description":"x"}}
      """
    E eu limpo os comandos registrados no par de domínio
    E eu faço POST "/companies" com o cookie de sessão e corpo:
      """
      {"name":"Loja Nova","site":"lojanova.com.br","description":"x"}
      """
    Então a resposta tem status HTTP 202
    E o comando "CreateCompany" publicado tem "tenant_id" igual ao tenant da sessão

  Cenário: Sem segredo de sessão as rotas de autenticação respondem 503
    Dado que eu tenho uma API sem segredo de sessão
    Quando eu faço o login com:
      """
      {"email":"ana@northwind.com","password":"segredo-forte"}
      """
    Então a resposta tem status HTTP 503

  # --- Google SSO (POST /auth/google) --------------------------------------

  Cenário: Google SSO de e-mail existente emite sessão (login)
    Dado que eu tenho uma API com autenticação e Google configurados
    E o usuário "ana@northwind.com" existe com a senha "segredo-forte" no par de domínio
    Quando eu faço o login com o Google usando a credencial "fake:ok:ana@northwind.com:Ana Souza"
    Então a resposta tem status HTTP 200
    E a resposta traz um cookie de sessão
    E o usuário da resposta tem "email" igual a "ana@northwind.com"

  Cenário: Google SSO de e-mail novo pede onboarding sem cookie
    Dado que eu tenho uma API com autenticação e Google configurados
    Quando eu faço o login com o Google usando a credencial "fake:ok:novo@northwind.com:Novo Usuário"
    Então a resposta tem status HTTP 200
    E a resposta pede onboarding
    E a resposta traz "email" igual a "novo@northwind.com"
    E a resposta traz "name" igual a "Novo Usuário"
    E a resposta NÃO traz cookie de sessão
    E o comando "CreateUser" NÃO foi publicado no par de domínio

  Cenário: Google SSO com token inválido devolve 401 sem cookie
    Dado que eu tenho uma API com autenticação e Google configurados
    Quando eu faço o login com o Google usando a credencial "token-invalido"
    Então a resposta tem status HTTP 401
    E a resposta NÃO traz cookie de sessão

  Cenário: Google SSO com e-mail não verificado devolve 401
    Dado que eu tenho uma API com autenticação e Google configurados
    Quando eu faço o login com o Google usando a credencial "fake:unverified:ana@northwind.com"
    Então a resposta tem status HTTP 401
    E a resposta NÃO traz cookie de sessão

  Cenário: Google SSO sem client ID configurado devolve 503
    Dado que eu tenho uma API com autenticação sem Google
    Quando eu faço o login com o Google usando a credencial "fake:ok:ana@northwind.com:Ana Souza"
    Então a resposta tem status HTTP 503

  # --- Cadastro com Google (POST /auth/signup + google_credential) ---------

  Cenário: Cadastro com Google cria empresa e usuário sem senha
    Dado que eu tenho uma API com autenticação e Google configurados
    Quando eu faço o cadastro com:
      """
      {"google_credential":"fake:ok:ana@northwind.com:Ana Souza","company":{"name":"Northwind Log","site":"northwindlog.com.br","description":"x"}}
      """
    Então a resposta tem status HTTP 201
    E a resposta traz um cookie de sessão
    E o comando "CreateCompany" foi publicado no par de domínio
    E o comando "CreateUser" foi publicado no par de domínio
    E o comando "CreateUser" publicado tem "email" igual a "ana@northwind.com"
    E o comando "CreateUser" publicado tem "password_hash" igual a ""
    E o comando "CreateUser" publicado tem "role" igual a "owner"

  Cenário: Cadastro com Google de credencial inválida é recusado sem escrita
    Dado que eu tenho uma API com autenticação e Google configurados
    Quando eu faço o cadastro com:
      """
      {"google_credential":"token-invalido","company":{"name":"Northwind Log"}}
      """
    Então a resposta tem status HTTP 401
    E o comando "CreateCompany" NÃO foi publicado no par de domínio
    E o comando "CreateUser" NÃO foi publicado no par de domínio

  Cenário: Cadastro com Google sem nome de empresa é recusado sem escrita
    Dado que eu tenho uma API com autenticação e Google configurados
    Quando eu faço o cadastro com:
      """
      {"google_credential":"fake:ok:ana@northwind.com:Ana Souza","company":{"name":"   "}}
      """
    Então a resposta tem status HTTP 422
    E o comando "CreateCompany" NÃO foi publicado no par de domínio

  # --- Troca de senha (POST /auth/password) --------------------------------

  Cenário: Troca de senha com a senha atual correta
    Dado que eu tenho uma API com autenticação configurada
    Quando eu faço o cadastro com:
      """
      {"name":"Ana Souza","email":"ana@northwind.com","password":"segredo-forte","company":{"name":"Northwind Log"}}
      """
    E eu faço POST "/auth/password" com o cookie de sessão e corpo:
      """
      {"current_password":"segredo-forte","new_password":"nova-senha-forte"}
      """
    Então a resposta tem status HTTP 204
    E o comando "UpdateUserPassword" foi publicado no par de domínio

  Cenário: Troca de senha com a senha atual errada devolve 401
    Dado que eu tenho uma API com autenticação configurada
    Quando eu faço o cadastro com:
      """
      {"name":"Ana Souza","email":"ana@northwind.com","password":"segredo-forte","company":{"name":"Northwind Log"}}
      """
    E eu faço POST "/auth/password" com o cookie de sessão e corpo:
      """
      {"current_password":"errada","new_password":"nova-senha-forte"}
      """
    Então a resposta tem status HTTP 401
    E o comando "UpdateUserPassword" NÃO foi publicado no par de domínio

  Cenário: Troca de senha com a nova senha fraca devolve 422 sem escrita
    Dado que eu tenho uma API com autenticação configurada
    Quando eu faço o cadastro com:
      """
      {"name":"Ana Souza","email":"ana@northwind.com","password":"segredo-forte","company":{"name":"Northwind Log"}}
      """
    E eu faço POST "/auth/password" com o cookie de sessão e corpo:
      """
      {"current_password":"segredo-forte","new_password":"123"}
      """
    Então a resposta tem status HTTP 422
    E o comando "UpdateUserPassword" NÃO foi publicado no par de domínio

  Cenário: Troca de senha sem sessão devolve 401
    Dado que eu tenho uma API com autenticação configurada
    Quando eu faço POST "/auth/password" sem o cookie de sessão e corpo:
      """
      {"current_password":"segredo-forte","new_password":"nova-senha-forte"}
      """
    Então a resposta tem status HTTP 401

  Cenário: Usuário só-Google define a senha com a senha atual vazia
    Dado que eu tenho uma API com autenticação e Google configurados
    E o usuário "googler@northwind.com" existe sem senha no par de domínio
    Quando eu faço o login com o Google usando a credencial "fake:ok:googler@northwind.com:Googler"
    E eu faço POST "/auth/password" com o cookie de sessão e corpo:
      """
      {"current_password":"","new_password":"nova-senha-forte"}
      """
    Então a resposta tem status HTTP 204
    E o comando "UpdateUserPassword" foi publicado no par de domínio
    E o comando "UpdateUserPassword" publicado tem "password_hash" começando com "$2"
