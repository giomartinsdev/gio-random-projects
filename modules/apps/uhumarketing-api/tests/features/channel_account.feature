Feature: Canal de WhatsApp por conta
  Cada conta ativa o PRÓPRIO WhatsApp. O serviço não tem WABA global: se o
  token fosse do processo, a conta de um cliente mandaria mensagem pelo número
  de outro — e a cobrança e o banimento cairiam no dono errado.

  Ativar não é colar um token e sair disparando: a ativação passa pela Graph,
  guarda o canal e só então o workspace fica apto a enviar. Sem canal ativo, o
  envio é recusado com o motivo — não vira mensagem simulada em silêncio.

  Background:
    Given um workspace de teste
    And um serviço com canal por conta em live

  Scenario: conta nova nasce sem canal ativo
    When eu leio o bootstrap
    Then o canal não está ativo
    And o bootstrap explica como ativar o WhatsApp

  Scenario: ativar o canal exige as três credenciais
    When eu ativo o canal com apenas o token
    Then a resposta é 422
    And a mensagem menciona "WABA"

  Scenario: ativar com credenciais recusadas pela Meta não grava o canal
    Given uma Graph de teste que recusa o token
    When eu ativo o canal live com credenciais completas
    Then a resposta é 422
    And a mensagem menciona "token"
    And o canal não está ativo

  Scenario: ativar com WABA banida não grava o canal
    Given uma Graph de teste com a WABA banida
    When eu ativo o canal live com credenciais completas
    Then a resposta é 422
    And a mensagem menciona "banida"
    And o canal não está ativo

  Scenario: ativar com credenciais válidas grava o canal e mostra o número
    Given uma Graph de teste que aceita o canal
    When eu ativo o canal live com credenciais completas
    Then a resposta é 200
    And o canal está ativo
    And o canal está live
    And o bootstrap mostra o telefone "5511912345678"

  Scenario: uma conta não vê o canal de outra
    Given uma Graph de teste que aceita o canal
    And que outra conta ativou o canal dela
    When eu leio o bootstrap
    Then o canal não está ativo

  Scenario: disparar sem canal ativo é recusado com motivo
    Given um template aprovado já existente
    And uma audiência com 1 contato com opt-in
    When eu disparo a campanha
    Then a resposta é 422
    And a mensagem menciona "canal"

  Scenario: desativar o canal apaga as credenciais e bloqueia o envio
    Given uma Graph de teste que aceita o canal
    And um template aprovado já existente
    And uma audiência com 1 contato com opt-in
    And eu ativo o canal live com credenciais completas
    When eu desativo o canal
    Then a resposta é 204
    And o canal não está ativo
    When eu disparo a campanha
    Then a resposta é 422

  Scenario: em dry-run a conta pode testar o produto sem canal real
    Given um serviço com canal por conta em dry-run
    When eu ativo o canal em dry-run com credenciais completas
    Then a resposta é 200
    And o canal está ativo
    And o canal não está live
    And o bootstrap diz que o canal é simulado

  Scenario: o envio usa o canal da conta, não um token do processo
    Given um serviço com canal por conta em dry-run
    And um template aprovado com 1 variável
    And uma audiência com 1 contato com opt-in
    And eu ativo o canal em dry-run com credenciais completas
    When eu disparo a campanha
    And a fila processa um lote
    Then existe um envio com id externo

  Scenario: o token do canal nunca volta para o navegador
    Given um serviço com canal por conta em dry-run
    When eu ativo o canal em dry-run com credenciais completas
    And eu leio o bootstrap
    Then a resposta não contém o token

  Scenario: o token não é gravado em claro no banco
    Given um serviço com canal por conta em dry-run
    When eu ativo o canal em dry-run com credenciais completas
    Then o token no banco não é o texto enviado
