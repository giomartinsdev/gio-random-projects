# language: pt
# Busca rápida (⌘K) e gate de administração no navegador.
#
# O atalho de teclado precisa de input REAL para valer: um KeyboardEvent
# sintético não prova que a tecla funciona no navegador da pessoa. Por isso este
# cenário é Playwright, não Vitest.
#
# O gate de administração, em modo demo, sempre mostra a pessoa demo como admin
# (o mock devolve is_admin: true) -- o que se verifica aqui é que a aba abre e o
# painel carrega; o NEGAR é testado no backend (clubs-api/admin_access_test.go e
# o .feature equivalente).

Funcionalidade: Busca rápida e administração
  Como alguém navegando o hub
  Quero achar um clube pelo teclado sem sair da tela
  Para chegar mais rápido ao que já sei que quero

  Cenário: ⌘K abre a busca rápida
    Dado que abro a home no navegador
    Quando pressiono "Meta+k"
    Então vejo a paleta de busca

  Cenário: A busca rápida acha um clube e navega
    Dado que abro a home no navegador
    Quando pressiono "Meta+k"
    E digito "Vila" na busca
    Então vejo um resultado de clube
    Quando pressiono "Enter"
    Então a URL tem um caminho de clube

  Cenário: Esc fecha a busca
    Dado que abro a home no navegador
    Quando pressiono "Meta+k"
    E pressiono "Escape"
    Então não vejo a paleta de busca

  Cenário: A aba de administração abre para quem tem permissão
    # No demo a pessoa é admin (is_admin: true); o painel deve carregar, não
    # mostrar "sem acesso". O NEGAR é testado no backend.
    Dado que abro "/admin" no navegador
    Então vejo o painel de administração

