# language: pt
# A história do clube: o acervo que a fonte não guarda.
#
# A EA só conhece o agora (nível atual, divisão atual, ~10 partidas recentes) e
# nunca diz "o clube chegou a 100 jogos" nem "o que mudou desde que você começou
# a acompanhar". Estes cenários fixam que a aba História mostra o que o hub
# ACUMULOU -- o motivo de voltar, e o que nenhum outro lugar tem.
#
# Rodam em modo demo, com o clube do mock.

Funcionalidade: História do clube
  Como alguém que acompanha um clube
  Quero ver o que mudou desde que comecei
  Para ter um motivo de voltar e um dado que a fonte não dá

  Cenário: A aba História mostra a linha do tempo do clube
    Quando abro "http://localhost:4173/club/1001"
    E clico na aba "History"
    Então vejo a linha do tempo acumulada

  Cenário: A aba História mostra a mudança desde que comecei a acompanhar
    Quando abro "http://localhost:4173/club/1001"
    E clico na aba "History"
    Então vejo o resumo desde que comecei a acompanhar
