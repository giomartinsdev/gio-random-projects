# language: pt
# A colisão de prefixo que já custou caro: o worker classificava ações da
# família "clubs." por prefixo, e o genérico "clubs." engolia "clubs.fetchRun".
# O pedido de fetch caía no case da saúde do worker, que gravava a saúde com
# zeros e NUNCA criava a linha da fila -- o clique na tela de resgate não fazia
# nada, sem erro nenhum.
#
# Estes cenários fixam o roteamento de cada ação para o seu destino, e o
# contrato de payload que o produtor (domain-api) e o consumidor (worker)
# precisam compartilhar. Foi um rename de payload que passou batido por testes
# de mock: o json.Unmarshal ignora chave desconhecida, então o campo vira zero
# em SILÊNCIO.

Funcionalidade: Roteamento das ações de clubs no worker
  Como mantenedor do worker
  Quero que cada ação da família clubs vá para o seu destino
  Para que um rename de payload não quebre a fila sem sintoma

  Cenário: O pedido de fetch vai para a fila, não para a saúde
    Quando classifico a ação "clubs.fetchRun"
    Então o destino é a fila de fetch

  Cenário: O resultado do fetch vai para a gravação da fila
    Quando classifico a ação "clubs.fetchRunSave"
    Então o destino é a gravação do fetch

  Cenário: O pedido de busca vai para a fila de busca
    Quando classifico a ação "clubs.searchRun"
    Então o destino é a fila de busca

  Cenário: A saúde do worker vai para o destino próprio
    Quando classifico a ação "clubs.ingestEstado"
    Então o destino é a saúde do worker

  Cenário: Uma ação desconhecida não é confundida com outra
    Quando classifico a ação "clubs.qualquerCoisa"
    Então o destino é outro

  Cenário: O resultado do fetch decodifica todos os campos do produtor
    # O payload é a cópia byte a byte do que o clubs-ingest (Python) publica.
    # Se um rename futuro mudar um lado só, aqui quebra -- em vez de a linha
    # gravar zeros em silêncio.
    Dado o payload de resultado de fetch:
      """
      {"target":"jogador","target_id":"p1","label":"x","running":false,"players":18,"matches":4,"clubs":4,"error":"","concluido":true}
      """
    Então o resultado de fetch decodifica com 18 jogadores, 4 partidas e 4 clubes
    E o resultado de fetch está concluído

  Cenário: A saúde do worker decodifica a saúde da fonte
    Dado o payload de saúde:
      """
      {"cycles":7,"clubs_ok":22,"clubs_failed":0,"new_matches":3,"snapshots":22,"bootstrapped":true,"last_error":"","source_available":false,"source_error":"clubs/info: 403"}
      """
    Então a saúde decodifica com 7 ciclos e 22 clubes ok
    E a saúde marca a fonte como indisponível com o motivo "clubs/info: 403"
