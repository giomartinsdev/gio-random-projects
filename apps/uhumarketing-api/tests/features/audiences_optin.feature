Feature: Opt-in e audiências
  O nó de descobrimento do editor precisa de uma fonte de verdade. Consentimento
  é registro, não um booleano solto: guardamos origem, texto aceito e quando,
  porque é isso que a Meta (e a LGPD) cobram numa auditoria. Importar uma lista
  sem opt-in é permitido, mas o contato entra como não consentido e fica fora de
  qualquer disparo de marketing.

  Background:
    Given um workspace de teste

  Scenario: registra um contato com opt-in explícito
    When eu crio o contato "Ana Lima" com telefone "5511988887777" e opt-in
    Then a resposta é 201
    And o contato tem uma linha de consentimento ativa

  Scenario: registra contato importado sem opt-in
    When eu crio o contato "Bruno Tavares" com telefone "5511977776666" sem opt-in
    Then a resposta é 201
    And o contato não pode receber marketing

  Scenario: recusa telefone inválido
    When eu crio o contato "Carla Dias" com telefone "telefone" e opt-in
    Then a resposta é 422
    And o campo do erro é "phone"

  Scenario: recusa telefone duplicado
    Given que existe um contato com telefone "5511966665555"
    When eu crio outro contato com telefone "5511966665555"
    Then a resposta é 409

  Scenario: audiência dinâmica conta só quem pode receber marketing
    Given 2 contatos com opt-in e 1 sem opt-in na cidade "São Paulo"
    When eu conto a audiência por cidade "São Paulo" com opt-in
    Then o total é 2

  Scenario: audiência por tag é case-insensitive
    Given um contato com opt-in e tag "VIP"
    When eu conto a audiência por tag "vip" com opt-in
    Then o total é 1

  Scenario: amostra da audiência vem preenchida
    Given uma audiência dinâmica por cidade "Curitiba"
    When eu listo as audiências
    Then a audiência tem amostra não vazia
