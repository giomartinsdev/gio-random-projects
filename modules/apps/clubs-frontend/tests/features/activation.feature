# language: pt
# Ativação: o que a pessoa vê quando o hub ainda está vazio.
#
# O problema: um visitante novo cai numa home com feed vazio, um gráfico vazio e
# um ranking que talvez não tenha o clube dele. As três primeiras telas vazias
# são lidas como "este produto não tem nada" -- e ele sai antes de descobrir o
# que o hub faz. A home precisa mostrar VALOR mesmo com a base magra: os
# recordes e destaques que já existem, e um caminho claro para trazer o próprio
# clube.
#
# Estes cenários fixam isso: com o hub magro, ainda há conteúdo e um convite; o
# estado vazio de verdade (base vazia de tudo) explica o que fazer em vez de só
# dizer "sem dados".

Funcionalidade: Home útil com o hub magro
  Como alguém que abre o hub pela primeira vez
  Quero ver conteúdo e um caminho para trazer meu clube
  Para não concluir que o produto está vazio e ir embora

  Cenário: A home sempre oferece o caminho de resgatar o clube
    # Mesmo sem login e sem feed, o convite para trazer o próprio clube fica
    # visível -- é o passo de ativação.
    Dado que abro a home sem login
    Então vejo o convite para encontrar meu clube

  Cenário: Com o feed vazio, a home mostra os destaques em vez de um vazio
    # A base tem clubes e jogadores, mas ainda nenhum anúncio. Em vez de um
    # cartão "sem anúncios" ocupando o lugar principal, mostramos quem se
    # destaca -- há dado, só não é do feed.
    Dado que abro a home sem login
    E o feed de anúncios está vazio
    Então vejo os destaques do hub

  Cenário: A busca de clube do resgate mostra o que já sabemos do clube
    # No passo de escolher o jogador, enquanto o elenco é buscado na fonte, a
    # pessoa vê o que o hub já sabe (campanha, forma). Um spinner sozinho não
    # diz se o clube é o certo -- e o elenco pode demorar.
    Quando escolho o clube "Vila Nova FC"
    Então vejo a campanha do clube antes do elenco carregar
