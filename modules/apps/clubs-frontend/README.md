# clubs-frontend

A SPA do **FC Clubs Hub** ([clubs.giomartins.dev](https://clubs.giomartins.dev)):
rankings globais, perfis de clube/partida/jogador, e o histórico que a EA não
guarda. Usável **sem login**; entrar acrescenta a camada pessoal.

## Os tokens vêm do design system

`ui.pen`, na raiz deste app, é a **fonte canônica** do design. As variáveis dele
(cor, tipografia, espaçamento, raio), com os dois temas, foram extraídas para
`src/index.css` como custom properties, e o Tailwind aponta para elas.

**Se o design mudar, muda-se o `ui.pen` e recopia-se `index.css`.** A
implementação não inventa valor de cor nem de fonte. O `ui.pen` é versionado;
os PNGs exportados não (são regeneráveis).

Tema claro e escuro saem de graça disso: o toggle escreve `<html data-theme>` e
nenhuma classe muda — o mesmo mecanismo do arquivo de design.

## Estrutura

```
src/
├── lib/
│   ├── types.ts     # o que a clubs-api devolve (sem termo técnico no payload)
│   ├── api.ts       # o único lugar que fala HTTP
│   ├── format.ts    # formatadores e rótulos de apresentação
│   └── hooks.ts     # sessão (probe de login), tema e status da sincronização
├── components/
│   ├── ui.tsx       # escudo, uniforme, badges, cartões, tabelas
│   ├── charts.tsx   # os gráficos, em SVG à mão
│   └── shell.tsx    # sidebar, navegação compacta e cabeçalho
└── pages/           # uma por tela
```

## Duas decisões de implementação que valem saber

**Sem biblioteca de gráficos.** Os seis gráficos (linha, barra, radar, rosca,
dispersão, sparkline-equivalente) são SVG gerado à mão. O design é autoral e
completo — adotar uma biblioteca significaria brigar com ela para reproduzir o
que o `.pen` já define, e o bundle fica ~90 kB gzip sem nenhuma dependência de
visualização.

**Hash routing, não um router.** Um app de leitura não precisa de mais, e o link
direto (`#/clube?id=…`, `#/partida?m=…`, `#/jogador?p=…`) sobrevive a recarregar
e ao botão voltar — que é o requisito, não uma preferência.

## Rodando local

```sh
npm install
npm run dev     # http://localhost:5173
```

O proxy do Vite resolve `/api` para `http://localhost:8017` (o `clubs-api`
local), então não há CORS a configurar em desenvolvimento. Para apontar para
outro backend: `VITE_CLUBS_API_URL=http://localhost:9000 npm run dev`.

```sh
npm run build     # tsc -b && vite build
npm run typecheck # tsc --noEmit
```

## Testes

Três camadas, cada uma para o que ela faz melhor:

```sh
npm test           # Vitest (jsdom): funções puras e comportamento de componente
npm run test:e2e   # BDD/e2e num navegador real (playwright-bdd)
npm run bdd        # = bddgen + playwright test (o mesmo, com o codegen explícito)
```

**BDD é a fonte de verdade.** Os cenários vivem em `tests/features/*.feature`
(Gherkin em português: Funcionalidade/Cenário/Dado/Quando/Então) e os passos em
`tests/steps/`. O `bddgen` gera os specs do Playwright a partir deles — os
arquivos gerados (`.features-gen/`) não são versionados: editar o gerado seria
editar a saída, não o contrato.

Por que duas ferramentas e não uma:

- **Vitest** é o lugar certo para as asserções que não merecem uma frase de
  negócio — a paridade `parse(pathFor(view)) === view` é uma propriedade, testada
  melhor numa tabela do que em sete cenários; e o roteamento é função pura, então
  `routing.test.ts` o cobre sem subir navegador.
- **Playwright/BDD** é o lugar certo para o que depende de navegador de verdade:
  navegar, clicar, voltar, o HTML que o crawler lê. O e2e roda contra o **build de
  produção em modo demo** (`VITE_CLUBS_DEMO=1`), então não depende de Postgres,
  do worker nem da EA — verifica a interface, não a cadeia inteira.

Em CI (onde não há Chrome de sistema) a pipeline seta `CLUBS_PW_CHANNEL=chromium`
para o Playwright usar o Chromium que ela instala; localmente o padrão é o Chrome
do sistema.

## Deploy

Build estático espelhado num bucket do MinIO, **sem container** — o mesmo modelo
de `tela-frontend`/`cch-frontend`/`bet-frontend`. Entra no
`ts-frontend-ci-cd.yml` pelo array `ALLOWED_APPS`.

A URL absoluta da API é gravada no bundle em tempo de build
(`VITE_CLUBS_API_URL`), então o proxy do Vite só existe em desenvolvimento.

## Embedável no hub

O app entra no hub como microfrontend, o que significa que ele **não pode**
redirecionar para um login do Google dentro do iframe — daí o modelo de acesso
ser "público, com login opt-in por caminho" em vez de SSO no hostname. Ver o
README do `clubs-api` para o desenho completo.
