# language: pt
# Rotas reais do FC Clubs Hub.
#
# O que estes cenários protegem: um link compartilhado de clube, partida ou
# jogador precisa ser um caminho REAL (/club/141881), não um fragmento depois do
# `#`. Um `#` nunca chega ao servidor, então nem buscador nem bot de preview
# (Discord, WhatsApp, X) enxergam a página -- e numa comunidade que vive de link
# em Discord, isso é a diferença entre um cartão que convida ao clique e um link
# pelado.
#
# Escritos em Gherkin de propósito: descrevem a INTENÇÃO (o que a pessoa vê ao
# abrir um link), não a implementação (pushState, regex). Quem implementa o
# roteamento pode mudar; o contrato de "o link abre na tela certa" não.

Funcionalidade: Rotas por caminho real
  Como alguém que compartilha um link do hub
  Quero que o link abra a página certa e seja enxergável por buscadores e bots
  Para que o link circule e traga gente

  Cenário: O link direto de um clube abre o perfil do clube
    Dado que abro o caminho "/club/141881"
    Então a view atual é o clube "141881"

  Cenário: O link direto de uma partida abre a partida
    Dado que abro o caminho "/match/m-99"
    Então a view atual é a partida "m-99"

  Cenário: O link direto de um jogador abre o perfil do jogador
    Dado que abro o caminho "/player/938806983"
    Então a view atual é o jogador "938806983"

  Cenário: Os caminhos de lista abrem sem parâmetro
    Quando abro o caminho "/clubs"
    Então a view atual é a lista de clubes
    Quando abro o caminho "/players"
    Então a view atual é a lista de jogadores
    Quando abro o caminho "/claim"
    Então a view atual é o resgate de pro

  Cenário: A raiz abre a home
    Quando abro o caminho "/"
    Então a view atual é a home

  Cenário: Um id com caractere especial sobrevive ao link
    # Um id que precise de escape na URL (espaço, acento) não pode chegar
    # truncado ao parse -- senão o link "funciona" abrindo a página errada.
    Dado que abro o caminho "/club/Clube%20Bom%20Demais"
    Então a view atual é o clube "Clube Bom Demais"

  Cenário: Barra final não muda a página
    Dado que abro o caminho "/club/141881/"
    Então a view atual é o clube "141881"

  Cenário: Query string é ignorada
    # O app não guarda mais estado na URL além do id; uma query antiga não pode
    # quebrar o parse.
    Dado que abro o caminho "/club/141881?utm_source=discord"
    Então a view atual é o clube "141881"

  Cenário: Um caminho desconhecido cai na home
    # Link velho ou digitado errado: melhor a home do que uma tela em branco.
    Quando abro o caminho "/nao-existe/123"
    Então a view atual é a home

  Cenário: O detalhe sem id cai na lista
    # "/club" sem id não é uma página válida; a lista é o fallback honesto em
    # vez de um detalhe vazio.
    Quando abro o caminho "/club"
    Então a view atual é a lista de clubes
    Quando abro o caminho "/player"
    Então a view atual é a lista de jogadores

  Cenário: Todo caminho gerado volta à mesma view
    # A propriedade que garante que navegar e compartilhar andam juntos:
    # parse(pathFor(v)) === v para toda view. Se um lado muda sem o outro, é
    # aqui que quebra.
    Então para toda view o caminho gerado volta à mesma view

  Cenário: Um link antigo em hash vira caminho real
    # A primeira versão roteava por hash (#/club?id=...). Esses links
    # circularam; quebrá-los seria transformar nossa migração em link morto.
    Quando converto o hash legado "#/club?id=141881"
    Então o caminho convertido é "/club/141881"
    Quando converto o hash legado "#/match?m=m-99"
    Então o caminho convertido é "/match/m-99"
    Quando converto o hash legado "#/players"
    Então o caminho convertido é "/players"

  Cenário: Um hash desconhecido não vira caminho
    Quando converto o hash legado "#/coisa-antiga"
    Então não há caminho convertido
