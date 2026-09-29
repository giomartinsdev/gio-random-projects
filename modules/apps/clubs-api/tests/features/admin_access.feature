# language: pt
# Gate de administração.
#
# O código era honesto ao dizer que "a restrição forte é uma decisão futura;
# hoje o login já basta" -- ou seja, QUALQUER pessoa logada via o painel
# técnico. Com login opt-in e aberto, isso é um buraco: o painel expõe o estado
# interno da ingestão. Estes cenários fixam que só quem está na lista de
# administradores entra; quem não está recebe 403, não o conteúdo.
#
# A lista vem de env (CLUBS_ADMIN_EMAILS), não de um papel no banco: é uma
# decisão de operação, não um dado do produto, e mantê-la fora do banco evita
# uma tabela e um fluxo de gestão só para meia dúzia de e-mails.

Funcionalidade: Acesso à administração
  Como alguém que opera o hub
  Quero que só administradores vejam o painel técnico
  Para que o estado interno não fique exposto a qualquer pessoa logada

  Cenário: A lista de administradores é normalizada
    # E-mail é comparado em minúsculas e sem espaços: "Ana@Corp.com " e
    # "ana@corp.com" são a mesma pessoa, e a lista digitada à mão num env costuma
    # ter espaços.
    Dado a lista de administradores "Ana@Corp.com , b@corp.com"
    Então "ana@corp.com" é administrador
    E "b@corp.com" é administrador
    E "c@corp.com" não é administrador

  Cenário: Sem lista configurada, ninguém é administrador
    # Negar por padrão: um env ausente não pode abrir o painel para todo mundo.
    Dado a lista de administradores ""
    Então "qualquer@corp.com" não é administrador
