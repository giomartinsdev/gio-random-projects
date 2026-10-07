# language: pt
# As tools de busca/enriquecimento (research R3): `web.search`,
# `web.scrape` e `enrich.company`. Cada uma é um adapter ISOLADO, com um
# contrato fixo, testável contra um upstream HTTP real em container -- não um
# mock do httpx.
#
#   - `web.search` fala Brave (default) OU SerpAPI e normaliza para
#     `[{title,url,snippet}]`; um 5xx não vira lista vazia silenciosa. O
#     provedor LOCAL `searxng` (SearXNG próprio, sem chave) entra pelo mesmo
#     adapter.
#   - `web.scrape` só lê página PÚBLICA: consulta o `robots.txt` do domínio e
#     RECUSA uma URL proibida (não é "melhor esforço"). O transporte impersona
#     um Chrome quando `curl_cffi` está instalado (CDNs que fingerprintam TLS
#     recusam httpx) e cai para httpx quando não está.
#   - `enrich.company` normaliza o provedor para um `enriched{}` estável. O
#     provedor LOCAL `cnpj` lê o site da empresa (e-mail/CNPJ/`<title>`) e a
#     Receita (publica.cnpj.ws) sem chave; nunca inventa o que não achou.
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

  Cenário: web.search searxng normaliza sem chave
    Dado que a busca searxng devolve o resultado "Northwind Log" em "https://northwindlog.com.br"
    Quando a tool searxng busca por "logística de frota sudeste"
    Então a busca devolve o título "Northwind Log" e a url "https://northwindlog.com.br"
    E a busca devolve o snippet "..."
    E a busca recebeu ao menos 1 chamada

  Cenário: web.search searxng sem base configurada degrada com aviso
    Dado que a busca searxng não está configurada
    Quando a tool searxng busca por "qualquer coisa"
    Então a busca devolve uma lista vazia
    E a busca recebeu 0 chamadas

  Cenário: web.scrape usa o transporte impersonado quando curl_cffi está disponível
    Dado que o transporte impersonado está disponível
    Quando a tool web.scrape lê "https://northwindlog.com.br/pages/sobre"
    Então o scrape devolve o título "Northwind Log"
    E o scrape usou o transporte impersonado

  Cenário: web.scrape cai para httpx quando curl_cffi não está instalado
    Dado que o transporte impersonado não está instalado
    Quando a tool web.scrape lê "https://northwindlog.com.br/pages/sobre"
    Então o scrape devolve o título "Northwind Log"
    E o scrape não usou o transporte impersonado

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

  Cenário: enrich.company cnpj lê o site e a Receita por domínio
    Dado que o site da empresa em "https://northwindlog.com.br" tem o título "Northwind Log"
    E o site traz o e-mail "contato@northwindlog.com.br" e o cnpj "12.345.678/0001-90"
    E a Receita devolve a razão social "Northwind Logistica LTDA" para o cnpj "12345678000190"
    Quando a tool enrich.company cnpj enriquece o domínio "northwindlog.com.br"
    Então o enriched cnpj tem company_name "Northwind Logistica LTDA" e cnpj "12.345.678/0001-90"
    E o enriched cnpj tem email "contato@northwindlog.com.br"
    E o enriched cnpj tem o decisor "Carlos Menezes, Ana Lima" e o segmento contendo "Transporte rodoviário de carga"

  Cenário: enrich.company cnpj sem CNPJ devolve o que achou sem erro
    Dado que o site da empresa em "https://semcnpj.com.br" tem o título "Sem CNPJ"
    E o site traz o e-mail "contato@semcnpj.com.br"
    Quando a tool enrich.company cnpj enriquece o domínio "semcnpj.com.br"
    Então o enriched cnpj tem company_name "Sem CNPJ"
    E o enriched cnpj não tem cnpj
    E o enriched cnpj tem email "contato@semcnpj.com.br"

  Cenário: enrich.company cnpj com o site fora do ar devolve vazio sem erro
    Dado que o site da empresa está fora do ar em "https://foradear.com.br"
    Quando a tool enrich.company cnpj enriquece o domínio "foradear.com.br"
    Então o enriched cnpj está vazio
