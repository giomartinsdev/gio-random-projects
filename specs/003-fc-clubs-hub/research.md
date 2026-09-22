# Research: FC Clubs Hub

Todas as incógnitas têm precedente direto no repositório — nenhuma pesquisa
externa foi necessária além de inspecionar a API da origem e o design system
já produzido. Nenhum item ficou marcado como NEEDS CLARIFICATION.

As cinco decisões estruturais foram confirmadas explicitamente com o dono do
produto antes de escrever o plano.

---

## 1. Onde os dados vivem

**Decision**: Persistência via **`domain-api` compartilhada** — nenhum serviço
novo ganha driver de banco. Cinco agregados novos (`clube`, `partida`,
`linha_partida`, `clube_snapshot`, `watchlist`/`preferencia`) com commands no
`domain-worker`, exatamente como `cch-api` faz para `cch_rooms`/
`cch_custom_decks` e como `financas` faz para `contas`/`transacoes`.

**Rationale**: É a convenção dominante e explícita do repositório ("nenhum
serviço novo ganha driver de banco próprio"), já validada em produção por
`cch-api`, `bookclub-api` e pelos quatro módulos de finanças. Escolha
confirmada pelo dono do produto.

**Alternatives considered**:

- *SQLite próprio no worker* (o desenho do protótipo): tecnicamente ótimo para
  série temporal append-only com escritor único, e mais simples de operar. Mas
  quebra a regra do repositório e cria um segundo modelo de persistência
  paralelo ao Postgres compartilhado — dois lugares para backup, auditoria e
  observabilidade. Rejeitado.
- *Postgres com driver no `clubs-api`* (padrão `bet-api`): tabelas `clubs_*`
  no mesmo Postgres, mas com migrations e driver próprios. Meio-termo que
  também contraria a convenção dominante. Rejeitado.
- *Banco de série temporal dedicado*: desproporcional para dezenas de clubes e
  um problema já resolvido pelo Postgres compartilhado. Rejeitado.

**Consequência de schema**: como o `domain-api` é o ponto de escrita, o
snapshot engine (que grava a cada ciclo) passa a escrever por HTTP. Isso
importa para o desenho do ciclo (ver §4).

---

## 2. Linguagem do worker de ingestão

**Decision**: **Python**, reaproveitando o client não oficial já existente
(`fc27_api.py`, 368 linhas, MIT), incorporado ao repositório como vendor com
atribuição.

**Rationale**: A origem fica atrás de um CDN (Akamai) que bloqueia requisições
que não se pareçam com as de um navegador — `curl` é barrado mesmo com os
cabeçalhos corretos, enquanto Python passa. O client já resolve isso e já
normaliza parte dos campos. O repositório já tem o pipeline Python
(`python-ci-cd.yml`, auto-descoberto por `pyproject.toml`) e o precedente
direto de worker com loop de polling (`pld-scraper`). Reescrever em Go exigiria
replicar os cabeçalhos e torcer para o comportamento do CDN ser idêntico.

**Alternatives considered**:

- *Worker em Go*: mais alinhado aos outros apps do repositório, mas o CDN é
  exatamente o risco que já custou investigação no client original. O custo de
  vencer o bloqueio de novo não se paga.
- *Node/TypeScript*: mesmo problema do Go, sem nenhum ganho — não há client
  pronto.

**Atribuição**: o client é de terceiro (`1erkandogan/fc27-clubs-api`, MIT).
Vai para `clubs-ingest/src/` com o `LICENSE` original preservado e crédito
explícito no cabeçalho do arquivo e no README do serviço (T-polish).

---

## 3. Stack e deploy do frontend

**Decision**: **React + Vite + TypeScript + Tailwind**, build estático
espelhado num bucket, sem container — o mesmo modelo de `tela-frontend` /
`cch-frontend` / `bet-frontend` / `financas-frontend`. Entra no array
`ALLOWED_APPS` de `ts-frontend-ci-cd.yml`.

**Rationale**: É o único caminho que passa pelo pipeline existente, que exige
`npm ci` + `tsc --noEmit` + `npm test` + `vite build`. O design system
produzido (`ui.pen`) usa variáveis e dois temas (claro/escuro) — isso mapeia
diretamente para CSS custom properties + Tailwind, que é o que os outros
frontends do repositório já fazem. Escolha confirmada pelo dono do produto.

**Alternatives considered**:

- *Manter o protótipo em JavaScript puro*: preservaria ~5k linhas já escritas,
  mas exigiria shims para satisfazer `tsc` e o passo de teste do pipeline, e o
  design system teria que ser portado manualmente para CSS de qualquer forma.
  Além disso, o protótipo não tem componente algum — é string de HTML montada
  à mão, o que não escala para o que falta.
- *Vanilla sem pipeline* (deploy manual do `dist`): mais rápido agora, mas foge
  do padrão de CI/CD do repositório e cria um app que ninguém sabe como
  redeployar. Rejeitado.

**Consequência**: a lógica de dados do protótipo (`js/data.js`, gerador
determinístico) é descartada como código e vira especificação de forma — o que
resta dela é o formato esperado de cada tela, que já está no `ui.pen` e vira os
tipos TypeScript.

---

## 4. Cadência e forma do ciclo de ingestão

**Decision**: Worker Python em loop, com **intervalo por tipo de consulta**
(partidas a cada 5–15 min, elenco e totais a cada hora, busca sob demanda), e
**snapshot por diff** — uma leitura nova de nível/divisão é gravada e comparada
com a anterior para gerar eventos de promoção/rebaixamento.

**Rationale**: É o único desenho possível dado que a origem não guarda
histórico (§ADR #1 do protótipo). O rate-limit por tipo é obrigatório porque a
origem é uma API pública sem contrato — consultar tudo a cada ciclo é a forma
mais rápida de ser bloqueado.

**Forma do ciclo**:

1. Lê a lista de clubes acompanhados da base.
2. Para cada clube, verifica se o TTL do tipo de consulta venceu.
3. Consulta a origem só para o que venceu; normaliza.
4. Grava via `domain-api`; para nível/divisão, grava o snapshot e computa o
   diff contra o último.
5. Falha de um clube é registrada e isolada — o ciclo continua.

**Alternatives considered**:

- *Cron externo disparando o worker uma vez*: mais simples, mas perde o estado
  em memória (o client original mantém um token de desafio do CDN que precisa
  sobreviver entre ciclos — `pld-scraper` tem exatamente essa mesma nota no seu
  código). Loop em processo é o padrão do repositório.
- *Consultar tudo a cada ciclo*: mais simples, e a forma mais direta de levar
  bloqueio.

---

## 5. Modelo de acesso: público com login opt-in

**Decision**: O **site e a API pública** ficam acessíveis a qualquer visitante.
Apenas as rotas pessoais (`/api/me`, preferências, watchlist, reivindicar pro) e
a área técnica ficam atrás do provedor de identidade, por escopo de caminho.

**Rationale**: É literalmente o pedido do dono do produto ("todas as telas
visíveis sem login e com login") e já existe um precedente exato no
repositório: o `hub` mantém o hostname público e protege apenas `/sso`
(`path_protected_hostnames` em `locals.tf`), e o `bet` protege apenas `/api` e
`/auth`. Seguir esse desenho evita inventar um modelo novo de acesso.

**Como fica**:

| Host | Situação | Por quê |
|---|---|---|
| `clubs.giomartins.dev` | público, fora do SSO | é a SPA pública, e precisa ser embutível no hub |
| `clubs-api.giomartins.dev` | público, fora do SSO | visitante sem conta lê as rotas públicas |
| `clubs-api.giomartins.dev/api` | atrás do SSO | só aqui o login é exigido |

**Alternatives considered**:

- *Tudo atrás de SSO*: contraria o requisito explícito e mataria o produto
  público.
- *Login próprio (email/senha)*: reinventa o que o provedor de identidade do
  ecossistema já resolve, e o `hub` inteiro usa esse login — a pessoa já está
  autenticada no ecossistema.

**Consequência importante**: "sincronizar meus clubes" **só existe autenticado**
— é o que faz o login valer. Sem login o hub é uma enciclopédia pública; com
login ele vira "meu hub". Isso precisa estar claro no quickstart para não ser
lido como bug.

---

## 6. Onde o worker se encaixa no deploy

**Decision**: O worker roda como container, **sem regra de ingress** — não tem
hostname nem porta publicada. Fala com o `domain-api` pela rede interna do
Docker, como `pld-scraper` e os outros workers.

**Rationale**: Precedente direto (`pld_scraper`, `phb_scraper`,
`events_announcer` não aparecem na lista de ingress). É um serviço de saída, não
uma API. Publicá-lo seria superfície de ataque sem ganho.

**Consequência**: o `clubs-api` é o único host novo de API. O worker precisa de
uma chave de acesso à base compartilhada, gerada pela infra (ver T-setup), e
não aparece na área de administração como serviço navegável — apenas seus
efeitos (contadores, cache, última sincronização).

---

## 7. Como o design system vira código

**Decision**: As variáveis do `ui.pen` (cor, tipografia, espaçamento, raio) são
a **fonte canônica dos tokens**, traduzidas para CSS custom properties com dois
temas, seguindo o que `hub-frontend` e `cch-frontend` já fazem. Os 56
componentes reutilizáveis viram componentes React com as mesmas variantes.

**Rationale**: As variáveis já carregam os dois temas definidos e a paleta
validada para contraste — extrair isso como token garante que implementação e
design não divirjam, e que trocar tema seja uma operação de uma variável, como
já é no arquivo de design.

**Alternatives considered**:

- *Copiar os valores à mão para o CSS*: divergiria do `.pen` na primeira
  mudança de cor. Rejeitado.
- *Biblioteca de componentes de terceiro*: o design já é autoral e completo;
  adotar uma biblioteca significaria lutar contra ela para reproduzir o que já
  existe. Rejeitado.

---

## 8. Decisões herdadas do protótipo que continuam válidas

Estas foram documentadas como ADRs no protótipo e permanecem de pé — não são
reabertas nesta feature:

| ADR | Conteúdo | Onde aparece |
|---|---|---|
| #1 | A origem não guarda histórico; nível, divisão, recordes e evolução de jogador nascem de leituras acumuladas | FR-009 a FR-014, §4 |
| #2 | Normalização dos formatos irregulares numa camada única | FR-017 |
| #3 | Identificadores sem tabela publicada (posição, estilo, nacionalidade, escudo, ids de evento) | FR-017 |
| #4 | O CDN bloqueia requisições não-navegador; por isso o worker é Python | §2 |
| #5 | Multi-clube desde o primeiro dia; seguir clube é nativo, não extra | FR-023, FR-025 |
| #6 | Login opt-in com sincronização em segundo plano, sem bloquear a navegação | FR-020 a FR-022 |
