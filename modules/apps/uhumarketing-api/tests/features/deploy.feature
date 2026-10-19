Feature: Deploy — o que muda quando o serviço sai do localhost

  Três coisas só aparecem quando o serviço é publicado: o operador precisa
  saber QUAL URL colar no painel da Meta, o webhook passa a ser alcançável por
  qualquer um (então assinatura deixa de ser opcional) e as rotas de
  desenvolvimento não podem existir num ambiente com dado real.

  Background:
    Given um workspace de teste
    And um provedor dry-run

  Scenario: o bootstrap mostra a URL de callback do webhook
    Given o serviço sabe que a base pública é "https://uhu.exemplo.com"
    When eu leio o bootstrap
    Then o bootstrap mostra o webhook "https://uhu.exemplo.com/webhooks/whatsapp"

  Scenario: sem base pública o bootstrap não inventa um webhook
    When eu leio o bootstrap
    Then o bootstrap não mostra webhook

  Scenario: em live, webhook sem assinatura é recusado
    Given o webhook exige assinatura
    When chego no webhook sem assinatura
    Then a resposta é 401

  Scenario: em live sem META_APP_SECRET o webhook falha fechado
    Given o webhook exige assinatura sem META_APP_SECRET
    When chego no webhook sem assinatura
    Then a resposta é 503
    And a mensagem menciona "META_APP_SECRET"

  Scenario: com as ações de desenvolvimento desligadas, o reset some
    Given as ações de desenvolvimento estão desligadas
    When eu peço o reset da conta
    Then a resposta é 404
