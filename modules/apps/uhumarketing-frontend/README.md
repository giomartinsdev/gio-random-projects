# uhumarketing (frontend)

Plataforma de marketing para pequenos negócios, com foco em WhatsApp. Esta é a
SPA do [`uhumarketing-api`](../uhumarketing-api): Postgres, fila de disparo,
webhook da Meta e provedor dry-run (ou live). Não existe modo demonstração nem
dado de exemplo — o que a tela mostra é o que está no banco, escopado na conta
de quem entrou.

A pergunta que o produto responde: *como um operador de marketing monta uma
campanha do zero, com regras de descoberta e outbound, sem depender de um
formulário fechado?* A resposta é um canvas livre, no estilo n8n.

## Rodar

```bash
npm install
npm run dev     # http://localhost:5180
npm run build   # tsc -b + vite build
```

A API precisa estar no ar (ver `../uhumarketing-api/README.md`):

```bash
cd ../uhumarketing-api && docker compose up -d --build
```

Variável (opcional, com este default):

| Variável | Default | Para quê |
| --- | --- | --- |
| `VITE_UHU_API_URL` | `http://localhost:8195` | Base da API |

`#/` é a landing pública; `#/cadastro` cria conta + workspace vazio; `#/login`
entra; `#/app/*` é o produto, atrás da sessão.

A sessão é um token opaco (`Authorization: Bearer`) guardado no `localStorage` e
validado no boot por `GET /auth/me`. Logout revoga o token no servidor. A senha
mínima é 8 caracteres.

## O que dá para fazer

| Tela | O que mostra |
| --- | --- |
| Visão geral | KPIs, série enviadas/lidas, funil, campanhas no ar, templates com melhor leitura, atividade |
| Templates Meta | Prévia de bolha, status de aprovação, qualidade e métricas; detalhe com funil; criação/duplicação com validação no padrão da Meta |
| Campanhas | Lista com filtros, métricas por campanha, detalhe com audiências/oferta/janela (editável); nova campanha nasce com um fluxo para montar |
| Automação | Fluxos como cartões (status, blocos, execuções, falhas); criar fluxo a partir de gatilho + audiência; pausar/duplicar |
| Editor de fluxo | O canvas: paleta de 19 blocos, arrastar, conectar, inspetor por tipo, validação e simulação |
| Audiências | Segmentos estáticos/dinâmicos/importados, regras e amostra de contatos; criar audiência e "usar em fluxo" |
| Envios | Log operacional por destinatário/campanha/template/cupom, linha do tempo e export CSV |
| Configurações | Negócio e número de WhatsApp (editáveis), políticas de envio, integrações, equipe, apagar os dados da conta |

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
    types.ts           modelo que as telas usam (espelha o bootstrap)
    store.tsx          contrato `Store` + KPIs/série derivados
    storeRemote.tsx    provider: bootstrap, PUT /state debounced, polling
    storeContext.tsx   o contexto que as telas consomem
    api.ts             cliente HTTP do uhumarketing-api
    token.ts           token de sessão (localStorage)
    session.tsx        login/cadastro/logout contra a API
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

## A camada de dados

As telas falam com `useStore()` e nunca com HTTP. O provider é
`src/lib/storeRemote.tsx`: mantém a interface **síncrona** (a UI é otimista: o
clique aplica na hora) e persiste o documento editorial com um `PUT /state`
debounced de 450 ms. O que o servidor é dono — status de template, fila, métricas
de campanha — volta pelo polling de 5 s e nunca é sobrescrito pelo navegador.

Não são otimistas, de propósito: **disparar campanha**, **enviar teste** e
**submeter template**. Custam dinheiro e/ou reputação do número; essas ações
esperam a resposta e mostram o erro real (`422` com `field`).

`src/lib/api.ts` é o cliente HTTP (com o Bearer da sessão). Nenhuma tela o
importa: se importasse, a regra de contrato vazaria para a apresentação.

## Limites conhecidos (de propósito)

- Com `META_MODE=dry-run`, a fila processa e grava ids externos falsos, mas nada
  sai para a Meta — não é dado de exemplo, é entrega desligada. Só `live` manda
  de verdade.
- `converted` e `revenue` ficam em zero: a POC não inventa conversão sem sinal
  real de pedido.
- Concorrência dentro da conta é last-write-wins. Dois operadores no mesmo
  canvas ainda não é um cenário suportado.
- Publicação (ingress/CI/bucket/hub) não existe: é `npm run dev` local. O
  backend também não entra no `compose.yaml` compartilhado — sobe pelo compose
  próprio dentro do app.
