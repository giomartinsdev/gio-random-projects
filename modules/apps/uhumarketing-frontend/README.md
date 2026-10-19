# uhumarketing (frontend)

POC de produto: uma plataforma de marketing para pequenos negócios, com foco em
WhatsApp. **Só frontend** — não há API, banco, bucket ou envio real. Todo o estado
vive no `localStorage` do navegador, e os dados iniciais são fictícios (Café
Aurora, uma torrefação de café especial).

A pergunta que a POC responde: *como um operador de marketing monta uma campanha
do zero, com regras de descoberta e outbound, sem depender de um formulário
fechado?* A resposta é um canvas livre, no estilo n8n.

## Rodar

```bash
npm install
npm run dev     # http://localhost:5180
npm run build   # tsc -b + vite build
```

A conta de demonstração é preenchida na tela de login — qualquer e-mail e senha
com 4+ caracteres entram. `#/` é a landing pública; `#/app/*` é o produto.

## O que dá para fazer

| Tela | O que mostra |
| --- | --- |
| Visão geral | KPIs, série enviadas/lidas, funil, campanhas no ar, templates com melhor leitura, atividade |
| Templates Meta | 10 templates com prévia de bolha, status de aprovação, qualidade e métricas; detalhe com funil; criação/duplicação com validação no padrão da Meta |
| Campanhas | Lista com filtros, métricas por campanha, detalhe com audiências/oferta/janela; nova campanha nasce com um fluxo para montar |
| Automação | Fluxos como cartões (status, blocos, execuções, falhas); criar fluxo a partir de gatilho + audiência; pausar/duplicar |
| Editor de fluxo | O canvas: paleta de 19 blocos, arrastar, conectar, inspetor por tipo, validação e simulação |
| Audiências | Segmentos estáticos/dinâmicos/importados, regras e amostra de contatos; criar audiência e "usar em fluxo" |
| Envios | Log operacional por destinatário/campanha/template/cupom, linha do tempo e export CSV |
| Configurações | Negócio, WhatsApp (WABA, qualidade, limite), políticas de envio, integrações, equipe, reset da demo |

## O editor de fluxo

É a peça central. Cada campanha é um grafo:

- **Gatilho**: manual, agendamento (cron) ou evento (`carrinho.abandonado`…).
- **Descoberta**: audiência, contatos do CRM, regras (`E`/`OU`), deduplicação, limite.
- **Mensagem e oferta**: template Meta com mapeamento de variáveis, cupom único por
  destinatário, personalização.
- **Lógica e tempo**: espera, teste A/B, condição, aguardar resposta.
- **Saída**: canal (WhatsApp/e-mail/SMS) com vazão, webhook, handoff para humano.

Interações: clique ou arraste um bloco da paleta; arraste o cabeçalho do nó para
mover; arraste da bolinha de saída até a bolinha de entrada para conectar; clique
na linha para ver as conexões no inspetor. "Enquadrar" ajusta o zoom ao conteúdo.

`Simular` percorre o grafo e devolve alcance, envios, leitura/receita previstas,
custo, duração, passo a passo e a mensagem final renderizada — sem enviar nada.
`Publicar` roda a validação: erro (sem gatilho, template não aprovado, sem canal)
bloqueia; aviso (nó solto, regra vazia) deixa publicar.

## Como está organizado

```
src/
  App.tsx              zonas pública/app + sessão
  lib/
    types.ts           modelo de domínio (fonte da verdade)
    mock.ts            seed: Café Aurora, templates, audiências, campanhas, envios, fluxos
    store.tsx          "API" mock: CRUD, KPIs, persistência em localStorage
    session.tsx        login/cadastro mock
    nodeCatalog.ts     19 tipos de nó (grupo, cor, resumo, config default)
    simulate.ts        simulação do grafo
    validate.ts        regras de publicação
    useHashRoute.ts    rotas por hash
  components/
    FlowCanvas.tsx     canvas + paleta + inspetor
    Sidebar.tsx, Topbar.tsx, Status.tsx, WhatsAppPreview.tsx
    ui/                design system (Button, Card, Input, Table, Drawer, Charts…)
    landing/           primitivos da landing clara
  pages/               uma tela por rota + landing/auth
```

O design system veio do `prospecta-frontend`: tema escuro (`#0B0B0D`/`#141416`/
`#1C1C20`), azul `#2563EB` só para ação, Inter + JetBrains Mono, `.caps`, dot-grid,
e a landing em tema claro (`lp-*`).

## Limites conhecidos (de propósito)

- Nada é enviado. O log de envios é uma amostra de 12 linhas; o dashboard usa o
  acumulado das campanhas para os volumes.
- A Meta é simulada: status de template, qualidade do número e custo por conversa
  são valores de referência, não integrações.
- O estado é local ao navegador: trocar de máquina começa do zero, e "Restaurar
  dados de exemplo" em Configurações volta ao seed.
- Publicação (ingress/CI/bucket) não existe ainda: é `npm run dev` local.
