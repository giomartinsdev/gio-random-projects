# language: pt
# Gate de administração.
#
# O código era honesto ao dizer que "a restrição forte é uma decisão futura;
# hoje o login já basta" -- ou seja, QUALQUER pessoa logada via o painel
# técnico. Com login opt-in e aberto, isso é um buraco: o painel expõe o estado
# interno da ingestão. Estes cenários fixam que só quem está na lista de
# administradores entra; quem não está recebe 403, não o conteúdo.
#
# A lista vem do env CLUBS_ADMIN_EMAILS e, quando ele está vazio, de um default
# HARDCODED (o dono do hub) -- não de um papel no banco: é uma decisão de
# operação, não um dado do produto, e mantê-la fora do banco evita uma tabela e
# um fluxo de gestão só para meia dúzia de e-mails.

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

  Cenário: Sem lista configurada, o dono do hub é administrador
    # O default hardcoded garante que o painel nunca fique inacessível por falta
    # de configuração -- mas é UMA pessoa, não "todo mundo".
    Dado que a lista de administradores não está configurada
    Então "giovannidealmeidamartins@gmail.com" é administrador
    E "qualquer@corp.com" não é administrador

  Cenário: O env sobrepõe o default
    # Quando CLUBS_ADMIN_EMAILS está definido, é ele que vale -- o default sai
    # de cena, então virar configurável depois não exige mexer no código.
    Dado a lista de administradores "ana@corp.com"
    Então "ana@corp.com" é administrador
    E "giovannidealmeidamartins@gmail.com" não é administrador
