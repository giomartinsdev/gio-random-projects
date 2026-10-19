# uhumarketing (frontend)

POC de produto: uma plataforma de marketing para pequenos negócios, com foco em
WhatsApp. A tela roda em **dois modos**, escolhidos em Configurações → Origem dos
dados:

- **Demonstração** — tudo em `localStorage`, dados fictícios (Café Aurora), nada
  sai do navegador. É o modo que abre o link sem backend no ar.
- **Backend real** — contra o [`uhumarketing-api`](../uhumarketing-api): Postgres,
  fila de disparo, webhook da Meta e provedor dry-run (ou live). O estado
  persiste, a fila anda e o opt-out é real.

A pergunta que a POC responde continua a mesma: *como um operador de marketing
monta uma campanha do zero, com regras de descoberta e outbound, sem depender de
um formulário fechado?* A resposta é um canvas livre, no estilo n8n.

## Rodar

```bash
npm install
npm run dev     # http://localhost:5180
npm run build   # tsc -b + vite build
```

Para o modo Backend, suba a API antes (ver `../uhumarketing-api/README.md`):

```bash
cd ../uhumarketing-api && docker compose up -d --build
```

Variáveis (opcionais, com estes defaults):

| Variável | Default | Para quê |
| --- | --- | --- |
| `VITE_UHU_API_URL` | `http://localhost:8195` | Base da API |
| `VITE_UHU_API_KEY` | `dev-key` | Chave enviada em `X-API-Key` |
| `VITE_UHU_DATA_SOURCE` | `demo` | Modo inicial na primeira visita (`demo`/`backend`) |

A escolha de modo fica no `localStorage`, não no build: a mesma build roda nos
dois. Trocar recarrega a página de propósito — evita que estado em memória de um
provider vaze para o outro.

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
    store.tsx          provider mock: CRUD, KPIs, persistência em localStorage
    storeRemote.tsx    provider do backend: bootstrap, PUT /state, polling
    storeContext.tsx   o contexto compartilhado pelos dois providers
    api.ts             cliente HTTP do uhumarketing-api
    dataSource.ts      escolha Demo/Backend (localStorage + env)
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

## Os dois modos, na prática

O ponto de troca é `src/lib/storeContext.tsx`: as telas falam com `useStore()`, e
nunca com HTTP. Há dois providers para o mesmo contexto:

- `src/lib/store.tsx` — mock, síncrono, `localStorage`.
- `src/lib/storeRemote.tsx` — backend. Mantém a interface **síncrona** (a UI é
  otimista: o clique aplica na hora) e persiste o documento editorial com um
  `PUT /state` debounced de 450 ms. O que o servidor é dono — status de template,
  fila, métricas de campanha — volta pelo polling de 5 s e nunca é sobrescrito
  pelo navegador.

Não são otimistas, de propósito: **disparar campanha**, **enviar teste** e
**submeter template**. Custam dinheiro e/ou reputação do número; essas ações
esperam a resposta e mostram o erro real (`422` com `field`).

`src/lib/api.ts` é o cliente HTTP. Nenhuma tela o importa — se importasse, o modo
Demonstração morreria na primeira divergência de contrato.

## Limites conhecidos (de propósito)

- No modo Demonstração, nada é enviado e a Meta é simulada: status, qualidade e
  custo são valores de referência.
- No modo Backend com `META_MODE=dry-run`, a fila processa e grava ids externos
  falsos, mas nada sai para a Meta. Só `live` manda de verdade.
- `converted` e `revenue` ficam em zero: a POC não inventa conversão sem sinal
  real de pedido.
- Concorrência é um workspace único, last-write-wins. Dois operadores no mesmo
  canvas ainda não é um cenário suportado.
- Publicação (ingress/CI/bucket/hub) não existe: é `npm run dev` local. O
  backend também não entra no `compose.yaml` compartilhado — sobe pelo compose
  próprio dentro do app.
