# language: pt
# O CORS da ACL: o navegador da SPA do financeiro chama esta API de uma
# origem diferente (a SPA é servida do bucket em finance.giomartins.dev; a API
# vive em finance-api.giomartins.dev). Sem os cabeçalhos CORS o browser
# bloqueia a resposta antes do JS vê-la, e a tela parece "morta" com a API no
# ar -- exatamente o modo de falha que este contrato existe para evitar.
#
# O que fica pinado aqui:
#   - uma origem da allowlist recebe os cabeçalhos e o preflight responde sem
#     chegar no handler;
#   - os cabeçalhos que a telemetria do SPA propaga (traceparent/tracestate/
#     baggage) e a X-API-Key estão permitidos -- um preflight que os negue
#     mata toda chamada antes de começar;
#   - uma origem fora da allowlist NÃO ganha Access-Control-Allow-Origin.

Funcionalidade: CORS da finance-api para a SPA
  Como a SPA do financeiro (origem finance.giomartins.dev)
  Quero chamar a finance-api de outra origem
  Para que a tela consiga ler a resposta no navegador

  Cenário: Origem permitida recebe os cabeçalhos CORS
    Dado que a origem "https://finance.giomartins.dev" está na allowlist
    Quando eu faço um GET de "/healthz" com essa origem
    Então a resposta tem Access-Control-Allow-Origin igual à origem

  Cenário: O preflight permite os cabeçalhos que a SPA usa
    Dado que a origem "https://finance.giomartins.dev" está na allowlist
    Quando eu faço um preflight de POST em "/commands" com essa origem
    Então a resposta permite o cabeçalho "X-API-Key"
    E a resposta permite o cabeçalho "traceparent"
    E o preflight não chega no handler

  Cenário: Origem fora da allowlist não ganha cabeçalho CORS
    Dado que a origem "https://evil.example" não está na allowlist
    Quando eu faço um GET de "/healthz" com essa origem
    Então a resposta não tem Access-Control-Allow-Origin

  Cenário: O preflight permite o DELETE (revogar conexão)
    Dado que a origem "https://finance.giomartins.dev" está na allowlist
    Quando eu faço um preflight de DELETE em "/openfinance/consents/x" com essa origem
    Então a resposta tem Access-Control-Allow-Origin igual à origem
    E o preflight não chega no handler
