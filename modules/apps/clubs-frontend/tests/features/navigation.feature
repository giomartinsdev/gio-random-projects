# language: pt
# Navegação real no navegador.
#
# Diferente de routing.feature (que testa o parse puro), estes cenários abrem o
# SPA num navegador de verdade e verificam o que a pessoa VÊ: a URL é um caminho
# real, o link direto abre a página certa, e o link antigo em hash é migrado. É
# o que prova que o roteamento por caminho substituiu o hash de ponta a ponta, e
# não só na função de parse.
#
# Rodam em MODO DEMO (VITE_CLUBS_DEMO=1, ver playwright.config): dado local e
# determinístico, sem backend. Por isso o id do clube é o do mock (1001), não um
# id real da fonte.

Funcionalidade: Navegação por caminho real no navegador
  Como alguém navegando o hub
  Quero que abrir uma página use um caminho compartilhável
  Para poder copiar e mandar o link para alguém

  Cenário: A URL inicial é um caminho real, não um hash
    Dado que abro "http://localhost:4173/"
    Então a URL não contém "#"
    E vejo o cabeçalho do hub

  Cenário: Abrir um clube por link direto mostra o clube
    Quando abro "http://localhost:4173/club/1001"
    Então vejo o nome do clube

  Cenário: Um caminho antigo em hash é migrado para o caminho real
    # Os links #/club?id=... circularam antes da migração; quebrá-los seria
    # transformar a migração em link morto.
    Quando abro "http://localhost:4173/#/club?id=1001"
    Então a URL é "http://localhost:4173/club/1001"
    E vejo o nome do clube

  Cenário: Um caminho desconhecido abre a home
    Quando abro "http://localhost:4173/rota-que-nao-existe"
    Então vejo o cabeçalho do hub
