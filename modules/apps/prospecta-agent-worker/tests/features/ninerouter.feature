# language: pt
# O 9router é a ÚNICA porta de IA do worker (research R2): interface
# OpenAI-compatible, `POST {NINEROUTER_BASE_URL}/chat/completions`, com
# `Authorization: Bearer` quando a chave está configurada, timeout curto e
# retry com backoff. Um 5xx transitório deve ser tentado de novo; um 5xx
# persistente não pode virar loop infinito -- o run decide a falha e a fila
# não trava.
#
# O 9router é um stub HTTP real (um container): o que se testa é a travessia de
# rede -- path, header, corpo -- e a política de retry, não um mock do httpx.

Funcionalidade: O cliente do 9router fala chat/completions
  Como o núcleo agêntico do Prospecta
  Quero chamar o 9router como provider único de IA
  Para planejar, redigir e extrair sinais sem acoplar a um provider

  Cenário: Uma chamada bem-sucedida devolve o completion
    Dado que o 9router responde com sucesso
    Quando o cliente pede um completion com o modelo "gpt-4o-mini"
    Então o completion tem o conteúdo "texto do modelo"
    E o 9router recebeu a chamada em "/chat/completions" com o modelo "gpt-4o-mini"
    E a chamada não usou streaming

  Cenário: Um 5xx transitório é retentado e depois sucede
    Dado que o 9router falha 2 vezes e depois responde com sucesso
    Quando o cliente pede um completion com o modelo "gpt-4o-mini"
    Então o completion tem o conteúdo "texto do modelo"
    E o 9router recebeu 3 chamadas

  Cenário: Um 5xx persistente não vira loop infinito
    Dado que o 9router responde 500 permanentemente
    Quando o cliente pede um completion com o modelo "gpt-4o-mini"
    Então o cliente levanta erro de 9router
    E o 9router recebeu menos de 10 chamadas

  Cenário: O contexto do lead é redigido (PII) antes de chegar ao 9router
    Dado que o 9router responde com sucesso
    Quando o worker redige com PII no contexto e no telefone "5521981962914"
    Então a chamada ao 9router não contém "carlos@northwind.com.br" nem "5521981962914"
    E a chamada ao 9router contém os marcadores de PII
