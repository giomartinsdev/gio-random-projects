Feature: Disparo de campanha em WhatsApp
  Uma campanha só vira mensagem enviada se: o template está aprovado, o
  workspace tem telefone configurado e o destinatário deu opt-in. Cada
  destinatário recebe no máximo uma vez por campanha — reenvio acidental em
  marketing é o erro mais caro que existe.

  Background:
    Given um workspace de teste
    And um provedor dry-run

  Scenario: dispara um template aprovado para contatos com opt-in
    Given um template aprovado com 1 variável
    And uma audiência com 2 contatos com opt-in e 1 sem opt-in
    When eu disparo a campanha
    Then a resposta é 201
    And a resposta diz que 2 envios entraram na fila
    And a resposta diz que 1 contato foi ignorado

  Scenario: recusa disparo com template não aprovado
    Given um template pendente de aprovação
    And uma audiência com 1 contato com opt-in
    When eu disparo a campanha
    Then a resposta é 422
    And a mensagem menciona "aprovar"

  Scenario: não envia duas vezes para o mesmo contato
    Given um template aprovado com 1 variável
    And uma audiência com 2 contatos com opt-in
    When eu disparo a campanha
    And eu disparo a campanha de novo
    Then o total de envios da campanha é 2
    And a segunda resposta diz que 0 envios entraram na fila

  Scenario: sem telefone no workspace o disparo é recusado
    Given um template aprovado com 1 variável
    And uma audiência com 1 contato com opt-in
    And o workspace está sem telefone
    When eu disparo a campanha
    Then a resposta é 422
    And a mensagem menciona "telefone"

  Scenario: a fila entrega e o webhook avança o status
    Given um template aprovado com 1 variável
    And uma audiência com 1 contato com opt-in
    When eu disparo a campanha
    And a fila processa um lote
    Then existe um envio com id externo
    When chega um webhook de mensagem "delivered" para esse id
    Then o envio fica "delivered"
    When chega um webhook de mensagem "read" para esse id
    Then o envio fica "read"

  Scenario: status fora de ordem não regride
    Given um template aprovado com 1 variável
    And uma audiência com 1 contato com opt-in
    When eu disparo a campanha
    And a fila processa um lote
    And existe um envio com id externo
    And chega um webhook de mensagem "read" para esse envio
    And chega um webhook de mensagem "delivered" para esse envio
    Then o envio continua "read"

  Scenario: falha do provedor vira falha do envio
    Given um provedor que falha com "recipient not in allowed list"
    And um template aprovado com 1 variável
    And uma audiência com 1 contato com opt-in
    When eu disparo a campanha
    And a fila processa um lote
    Then o envio fica "failed"
    And o erro do envio menciona "allowed list"

  Scenario: a resposta do cliente revoga o opt-in
    Given um template aprovado com 1 variável
    And uma audiência com 1 contato com opt-in
    When eu disparo a campanha
    And a fila processa um lote
    And o contato responde "PARAR" no WhatsApp
    Then o contato fica sem opt-in
    And o histórico guarda a revogação
