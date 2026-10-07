# language: pt
# As tools de busca/enriquecimento (research R3): `web.search`,
# `web.scrape` e `enrich.company`. Cada uma é um adapter ISOLADO, com um
# contrato fixo, testável contra um upstream HTTP real em container -- não um
# mock do httpx.
#
#   - `web.search` fala Brave (default) OU SerpAPI e normaliza para
#     `[{title,url,snippet}]`; um 5xx não vira lista vazia silenciosa.
#   - `web.scrape` só lê página PÚBLICA: consulta o `robots.txt` do domínio e
#     RECUSA uma URL proibida (não é "melhor esforço").
#   - `enrich.company` normaliza o provedor para um `enriched{}` estável.
#
# O provedor concreto (SerpAPI/Brave/Clearbit/Apollo) é decisão da T036; aqui a
# interface é o que fica travado.

Funcionalidade: Os adapters de tool do agente
  Como o núcleo agêntico do Prospecta
  Quero buscar, raspar e enriquecer contra upstreams reais
  Para que o agente tenha dados sem acoplar a um provedor

  Cenário: web.search normaliza os resultados do Brave
    Dado que a busca devolve o resultado "Northwind Log" em "https://northwindlog.com.br"
    Quando a tool web.search busca por "logística de frota sudeste"
    Então a busca devolve o título "Northwind Log" e a url "https://northwindlog.com.br"

  Cenário: web.search propaga o erro do provedor
    Dado que a busca responde 500 permanentemente
    Quando a tool web.search busca por "qualquer coisa"
    Então a tool levanta um erro de tool
    E a busca recebeu menos de 10 chamadas

  Cenário: web.search sem chave devolve zero resultados sem tocar a rede
    Dado que a busca não está configurada
    Quando a tool web.search busca por "qualquer coisa"
    Então a busca devolve uma lista vazia
    E a busca recebeu 0 chamadas

  Cenário: web.scrape lê uma página pública e extrai o texto
    Dado que o robots.txt permite a leitura
    E que a página pública tem o título "Northwind Log" e o texto "Frota e roteirização"
    Quando a tool web.scrape lê "https://northwindlog.com.br/pages/sobre"
    Então o scrape devolve o título "Northwind Log"
    E o scrape devolve o texto contendo "Frota e roteirização"

  Cenário: web.scrape recusa uma URL proibida pelo robots.txt
    Dado que o robots.txt proíbe a leitura
    Quando a tool web.scrape lê "https://northwindlog.com.br/pages/sobre"
    Então a tool levanta um erro de robots

  Cenário: enrich.company normaliza o provedor para enriched
    Dado que o enriquecimento devolve a empresa "Northwind Log" com decisor "Carlos Menezes"
    Quando a tool enrich.company enriquece o domínio "northwindlog.com.br"
    Então o enriched tem company_name "Northwind Log" e decisor "Carlos Menezes"
    E o enriched tem a chave "cnpj"
