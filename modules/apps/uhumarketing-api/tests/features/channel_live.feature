Feature: Canal de WhatsApp — verificação real e envio de teste
  Duas coisas que o operador faz antes de confiar numa campanha: perguntar ao
  provedor se o canal responde de verdade, e mandar UMA mensagem para conferir
  no aparelho. Nenhuma das duas pode fingir: a verificação em dry-run diz que
  não é live, e o envio de teste sai na hora — esperar a janela comercial
  transformaria "testar agora" em "testar segunda às 9h".

  Background:
    Given um workspace de teste
    And um provedor dry-run

  Scenario: a verificação em dry-run diz que nada sai para a Meta
    When eu verifico o canal
    Then a resposta é 200
    And a verificação diz que não é live
    And a verificação menciona "dry-run"

  Scenario: a verificação exige telefone configurado no workspace
    Given o workspace está sem telefone
    When eu verifico o canal
    Then a resposta é 422
    And a mensagem menciona "telefone"

  Scenario: a verificação em live confirma o número na Graph API
    Given um canal live apontando para uma Graph de teste
    And o workspace está com o telefone configurado
    When eu verifico o canal
    Then a resposta é 200
    And a verificação diz que é live
    And a verificação mostra o número "5511912345678"
    And a verificação mostra o nome verificado "Café Aurora"

  Scenario: a verificação em live devolve o erro da Meta sem esconder
    Given um canal live apontando para uma Graph de teste que recusa o token
    And o workspace está com o telefone configurado
    When eu verifico o canal
    Then a resposta é 200
    And a verificação diz que o canal não está ok
    And a verificação menciona "Invalid OAuth access token"

  Scenario: o envio de teste sai mesmo com a janela da campanha fechada
    Given um template aprovado com 1 variável
    And uma audiência com 1 contato com opt-in
    And a campanha só pode enviar numa janela fechada agora
    When eu envio um teste da campanha
    And a fila processa um lote
    Then existe um envio com id externo
    And o envio fica "sent"

  Scenario: o disparo real continua respeitando a janela fechada
    Given um template aprovado com 1 variável
    And uma audiência com 1 contato com opt-in
    And a campanha só pode enviar numa janela fechada agora
    When eu disparo a campanha
    And a fila processa um lote
    Then nenhum envio tem id externo

  Scenario: o envio de teste pode ser repetido depois de sair
    Given um template aprovado com 1 variável
    And uma audiência com 1 contato com opt-in
    When eu envio um teste da campanha
    And a fila processa um lote
    And eu envio um teste da campanha de novo
    Then a resposta diz que 1 envios entraram na fila

  Scenario: dois cliques no envio de teste não enfileiram duas mensagens
    Given um template aprovado com 1 variável
    And uma audiência com 1 contato com opt-in
    When eu envio um teste da campanha
    And eu envio um teste da campanha de novo
    Then a resposta diz que 0 envios entraram na fila
    And o total de envios da campanha é 1

  Scenario: o envio de teste vai para o opt-in mais recente, não para um contato qualquer
    Given um template aprovado com 1 variável
    And uma audiência com 2 contatos com opt-in
    When eu envio um teste da campanha
    Then o envio de teste é para o último contato cadastrado

  Scenario: o disparo real continua sem duplicar para o mesmo contato
    Given um template aprovado com 1 variável
    And uma audiência com 1 contato com opt-in
    When eu disparo a campanha
    And eu disparo a campanha de novo
    Then a segunda resposta diz que 0 envios entraram na fila

  Scenario: sincronizar um template em análise traz a aprovação da Meta
    Given um canal live apontando para uma Graph de teste com o template "approved"
    And um template pendente com id externo "tpl_externo_1"
    When eu sincronizo o status do template
    Then a resposta é 200
    And o template fica "approved"

  Scenario: sincronizar um template em dry-run é recusado com explicação
    Given um template pendente com id externo "tpl_externo_1"
    When eu sincronizo o status do template
    Then a resposta é 422
    And a mensagem menciona "dry-run"
