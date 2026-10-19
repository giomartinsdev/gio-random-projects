Feature: Templates de mensagem da Meta
  O uhumarketing-api é o dono dos templates do workspace. Ele valida antes de
  gastar uma submissão, submete ao provedor e deixa o status mudar só por
  webhook. Um template que "parece" criado mas nunca foi submetido é pior do
  que um erro claro na tela.

  Background:
    Given um workspace de teste
    And um provedor dry-run

  Scenario: cria um template válido e submete ao provedor
    When eu crio o template "reativacao_cupom_volta" com categoria marketing e 4 variáveis
    Then a resposta é 201
    And o template fica aprovado
    And o template tem um id externo do provedor
    And existe atividade do tipo "template"

  Scenario: recusa nome que não é snake_case
    When eu crio o template "Reativação Cupom" com categoria marketing e 1 variável
    Then a resposta é 422
    And o campo do erro é "name"
    And nenhum template novo é gravado

  Scenario: recusa variável sem exemplo
    When eu crio um template chamado "sem_exemplo" com uma variável sem exemplo
    Then a resposta é 422
    And a mensagem menciona "exemplo"

  Scenario: recusa corpo que usa placeholder não declarado
    When eu crio um template chamado "buraco" cujo corpo usa {{2}} sem declarar
    Then a resposta é 422
    And a mensagem menciona "{{2}}"

  Scenario: recusa nome duplicado
    Given que existe um template chamado "boas_vindas"
    When eu crio outro template chamado "boas_vindas"
    Then a resposta é 409

  Scenario: editar um template aprovado devolve para rascunho
    Given que existe um template aprovado
    When eu altero o corpo desse template
    Then o template fica em rascunho
    And o template mantém o id externo anterior

  Scenario: webhook aprova o template
    Given que existe um template pendente com id externo "ext-123"
    When chega um webhook de template "APPROVED" para "ext-123"
    Then o template fica aprovado

  Scenario: webhook de rejeição guarda o motivo
    Given que existe um template pendente com id externo "ext-124"
    When chega um webhook de template "REJECTED" para "ext-124" com motivo "INVALID_FORMAT"
    Then o template fica rejeitado
    And o motivo da rejeição menciona "INVALID_FORMAT"

  Scenario: webhook de id externo desconhecido não quebra
    When chega um webhook de template "APPROVED" para "nao-existe"
    Then a resposta é 200

  Scenario: webhook com assinatura inválida é rejeitado
    Given a verificação de assinatura está ligada
    When chego no webhook sem assinatura
    Then a resposta é 401
