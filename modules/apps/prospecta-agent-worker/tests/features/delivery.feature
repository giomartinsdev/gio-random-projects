# language: pt
# O ENVIO por evento de domínio (US3): o domínio aprova (`MessageApproved`) e o
# worker envia -- depois dos guardrails. É o caminho "humano aprovou" ponta a
# ponta, diferente do `send_message` direto de messaging.feature.
#
#   - `MessageApproved` (whatsapp) → Evolution `sendText` + `MessageSent`;
#   - `MessageApproved` (email) → e-mail de SAÍDA (adapter `EmailClient`) +
#     `MessageSent`;
#   - a mensagem enviada é PERSISTIDA na prospecta-api (`POST /messages`),
#     alinhando o comando de domínio ao estado real;
#   - opt-out é consultado ANTES de todo envio; bloqueado → `MessageBlocked`,
#     nunca contorna (LGPD/R7);
#   - idempotência: a reentrega do mesmo `MessageApproved` não envia de novo.
#
# O e-mail sai por um SMTP real (o servidor do container de stubs): o
# `SmtpEmailClient` abre socket, faz o handshake e o stub guarda o que chegou.
# O provedor definitivo (SES vs SMTP) é decisão do humano (D9); a interface
# `EmailClient` é o que fica travado.

Funcionalidade: O worker entrega a mensagem aprovada pelo canal certo
  Como o núcleo agêntico do Prospecta
  Quero consumir MessageApproved e enviar por WhatsApp ou e-mail
  Para entregar a abordagem aprovada sem violar opt-out

  Cenário: Uma mensagem aprovada de WhatsApp sai pela Evolution e publica MessageSent
    Dado uma mensagem "msg-1" aprovada no canal "whatsapp" para "5521981962914"
    Quando o domínio publica o evento "MessageApproved" para a mensagem "msg-1"
    Então a Evolution recebeu o texto "Olá, Carlos!" para o número "5521981962914"
    E o worker publicou o evento "MessageSent" para a mensagem "msg-1"
    E a mensagem "msg-1" foi persistida na prospecta-api

  Cenário: Uma mensagem aprovada de e-mail sai pelo SMTP e publica MessageSent
    Dado uma mensagem "msg-2" aprovada no canal "email" para "carlos@northwind.com.br"
    Quando o domínio publica o evento "MessageApproved" para a mensagem "msg-2"
    Então o SMTP recebeu um e-mail para "carlos@northwind.com.br"
    E o worker publicou o evento "MessageSent" para a mensagem "msg-2"
    E a mensagem "msg-2" foi persistida na prospecta-api

  Cenário: Um lead em opt-out não é abordado e não persiste mensagem
    Dado uma mensagem "msg-1" aprovada no canal "whatsapp" para "5521981962914"
    E que o lead "lead-1" está em opt-out
    Quando o domínio publica o evento "MessageApproved" para a mensagem "msg-1"
    Então nenhum envio chegou à Evolution
    E o worker publicou o evento "MessageBlocked" para o lead "lead-1"
    E nenhuma mensagem foi persistida na prospecta-api

  Cenário: A reentrega do mesmo MessageApproved não envia de novo
    Dado uma mensagem "msg-1" aprovada no canal "whatsapp" para "5521981962914"
    E um lead conhecido para o telefone "5521981962914"
    Quando o domínio publica o evento "MessageApproved" duas vezes para a mensagem "msg-1"
    Então a Evolution recebeu o texto "Olá, Carlos!" uma vez
