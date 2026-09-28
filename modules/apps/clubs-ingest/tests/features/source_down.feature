# language: pt
# Fonte fora: o que o worker faz quando a EA/CDN começa a devolver 403.
#
# O comportamento que estes cenários fixam é o que o produto promete:
#   - quando a fonte recusa, o pedido NÃO é dado por concluído com zero (o que
#     apareceria na tela como "0 jogadores", parecendo "este clube não tem
#     dados");
#   - o pedido fica PENDENTE, para o dado sincronizar sozinho quando a fonte
#     voltar;
#   - a saúde da fonte é publicada, para a interface poder avisar.
#
# Rodam contra um domain-api de verdade (um container), porque a travessia de
# rede e o contrato do payload são parte do que se testa -- foi um rename de
# payload que passou batido por testes de mock.

Funcionalidade: Tratamento de fonte indisponível
  Como alguém que pediu a atualização de um clube
  Quero que uma falha da fonte não vire "sem dados"
  Para saber que é a fornecedora dos dados que está fora, e não o clube

  Cenário: A fonte fora deixa o pedido pendente e registra a saúde
    Dado que a fila tem o clube "141881" pendente
    E a fonte está fora
    Quando o worker drena a fila de fetch
    Então nenhum resultado foi gravado para o alvo
    E a saúde publicada marca a fonte como indisponível

  Cenário: A fonte volta e o mesmo pedido é atendido
    Dado que a fila tem o clube "141881" pendente
    E a fonte está fora
    Quando o worker drena a fila de fetch
    E a fonte volta
    E o worker drena a fila de fetch de novo
    Então um resultado foi gravado para o alvo "141881"

  Cenário: Um erro permanente fecha a linha
    Dado que a fila tem o clube "quebrado" pendente
    E a fonte responde, mas o clube é inválido
    Quando o worker drena a fila de fetch
    Então um resultado foi gravado para o alvo "quebrado"
