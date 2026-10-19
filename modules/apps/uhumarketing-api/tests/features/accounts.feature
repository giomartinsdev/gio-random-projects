Feature: Conta e isolamento por workspace
  Cada pessoa que se cadastra ganha um workspace próprio, vazio. Nada de dados
  de demonstração: os números da tela têm que ser os números da conta. Um
  workspace nunca enxerga o dado de outro — e isso é regra do servidor, não um
  filtro da interface.

  Background:
    Given um servidor de teste sem dados semeados

  Scenario: cadastro cria uma conta com workspace vazio
    When eu me cadastro com "marina@cafeaurora.com.br" e senha "cafe1234"
    Then a resposta é 201
    And a resposta traz um token de sessão
    And o workspace da conta se chama "Café Aurora"
    And a conta não tem templates
    And a conta não tem contatos
    And a conta não tem campanhas
    And a conta não tem envios

  Scenario: o mesmo e-mail não pode se cadastrar duas vezes
    Given uma conta com o e-mail "marina@cafeaurora.com.br"
    When eu me cadastro com "marina@cafeaurora.com.br" e senha "outrasenha"
    Then a resposta é 409
    And a mensagem menciona "e-mail"

  Scenario: cadastro recusa senha curta
    When eu me cadastro com "marina@cafeaurora.com.br" e senha "123"
    Then a resposta é 422
    And o campo do erro é "password"

  Scenario: cadastro recusa e-mail inválido
    When eu me cadastro com "marina" e senha "cafe1234"
    Then a resposta é 422
    And o campo do erro é "email"

  Scenario: login devolve token e o mesmo workspace
    Given uma conta com o e-mail "marina@cafeaurora.com.br"
    When eu faço login com "marina@cafeaurora.com.br" e a senha certa
    Then a resposta é 200
    And a resposta traz um token de sessão
    And o workspace é o mesmo do cadastro

  Scenario: login com senha errada não devolve token
    Given uma conta com o e-mail "marina@cafeaurora.com.br"
    When eu faço login com "marina@cafeaurora.com.br" e a senha errada
    Then a resposta é 401
    And a resposta não traz token

  Scenario: sem token não se lê o bootstrap
    When eu leio o bootstrap sem token
    Then a resposta é 401

  Scenario: token inválido não se lê o bootstrap
    When eu leio o bootstrap com o token "nao-e-um-token"
    Then a resposta é 401

  Scenario: duas contas não se enxergam
    Given uma conta com o e-mail "marina@cafeaurora.com.br"
    And outra conta com o e-mail "joao@outracafe.com.br"
    When eu crio um template na primeira conta
    And eu leio os templates da segunda conta
    Then a segunda conta vê zero templates

  Scenario: um envio de uma conta não aparece na outra
    Given uma conta com o e-mail "marina@cafeaurora.com.br"
    And outra conta com o e-mail "joao@outracafe.com.br"
    When a primeira conta monta uma campanha com 1 contato e dispara
    And a fila processa todos os workspaces
    Then a primeira conta tem envios
    And a segunda conta não tem envios

  Scenario: conta nova não herda o workspace de demonstração
    When eu me cadastro com "nova@empresa.com.br" e senha "cafe1234"
    Then a resposta é 201
    And a conta não tem templates
    And não existe workspace "ws_cafe_aurora" no banco

  Scenario: apagar os dados da conta não repõe demonstração
    Given uma conta com o e-mail "marina@cafeaurora.com.br"
    And eu crio um template na primeira conta
    When eu apago os dados da conta
    Then a resposta é 200
    And a conta não tem templates
    And a conta continua existindo

  Scenario: logout invalida o token
    Given uma conta com o e-mail "marina@cafeaurora.com.br"
    When eu faço logout
    And eu leio o bootstrap com o mesmo token
    Then a resposta é 401
