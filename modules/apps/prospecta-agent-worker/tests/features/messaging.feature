# language: pt
# A abordagem (US3): o agente redige, o humano aprova, e o worker envia. Estes
# cenários fixam o CONTRATO DE SAÍDA do WhatsApp e os GUARDRAILS de envio:
#   - a saída é `POST {EVOLUTION_API_URL}/message/sendText/{instance}` com header
#     `apikey` e corpo `{"number":"<E.164 sem +>","text":...}` (Evolution
#     v2.3.7); o número é o remoteJid SEM o sufixo `@s.whatsapp.net`;
#   - opt-out é consultado ANTES de todo envio; se o lead está na lista, o
#     worker NÃO envia e publica `MessageBlocked` -- nunca contorna (LGPD);
#   - `policy.approval=human` (MVP): sem aprovação, nenhum envio automático.
#
# A Evolution e a prospecta-api são stubs HTTP reais (um container): o que se
# testa é a travessia de rede -- URL montada, header `apikey`, número sem
# sufixo -- não um mock dela.

Funcionalidade: O worker envia a abordagem pela Evolution com guardrails
  Como o núcleo agêntico do Prospecta
  Quero enviar a mensagem aprovada pela Evolution API
  Para abordar o lead sem violar opt-out nem a política de aprovação

  Cenário: Uma mensagem aprovada sai pela Evolution com apikey e número E.164
    Dado um lead conhecido para o telefone "5521981962914"
    Quando o worker envia a mensagem aprovada "Olá, Carlos!" para o telefone "5521981962914"
    Então a Evolution recebeu o texto "Olá, Carlos!" para o número "5521981962914"
    E o envio usou o header apikey e o Content-Type application/json

  Cenário: Um lead em opt-out não é abordado e publica MessageBlocked
    Dado um lead conhecido para o telefone "5521981962914"
    E que o lead "lead-1" está em opt-out
    Quando o worker envia a mensagem aprovada "Olá!" para o telefone "5521981962914"
    Então nenhum envio chegou à Evolution
    E o worker publicou o evento "MessageBlocked" para o lead "lead-1"

  Cenário: Sem aprovação humana (policy.approval=human), o envio é bloqueado
    Dado um lead conhecido para o telefone "5521981962914"
    Quando o worker envia a mensagem não aprovada "Olá!" para o telefone "5521981962914"
    Então nenhum envio chegou à Evolution
    E o worker publicou o evento "MessageBlocked" para o lead "lead-1"
