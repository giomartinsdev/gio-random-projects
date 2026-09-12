# financas-frontend

SPA única para a feature "Gestão Financeira Modular"
(`specs/002-gestao-financeira-modular/`), cobrindo os 4 módulos:
**Contas**, **Transacional**, **Asset Manager** e **Dashboard**. Não tem
banco/BFF próprio — fala direto por CORS (`credentials: "include"`) com
os 4 microsserviços do desenho:

| Módulo | Env var | Fallback dev |
|---|---|---|
| Contas | `VITE_CONTAS_API_URL` | `http://localhost:8020` |
| Transacional | `VITE_TRANSACIONAL_API_URL` | `http://localhost:8021` |
| Asset Manager | `VITE_ASSET_MANAGER_API_URL` | `http://localhost:8022` |
| Dashboard | `VITE_DASHBOARD_API_URL` | `http://localhost:8023` |

Mesma stack de `hub-frontend`/`tela-frontend`: Vite + React 19 +
TypeScript + Tailwind, `react-router` para as 4 rotas, `framer-motion`
para motion sutil, `lucide-react` para ícones.

## Login / sessão

Cada um dos 4 BFFs roda atrás do próprio Cloudflare Access (mesmo padrão
de `bet-api`/`hub-frontend`: `GET /api/sso` responde `200` com sessão
válida, redirect sem ela). Como os 4 vivem sob o mesmo time de Access,
uma única sessão cobre todos — por isso `src/lib/auth.ts` proba **apenas
a `contas-api`** como "âncora" de login (é o módulo raiz: sem conta não
existe onde lançar transação nem ativo, US1 da spec) em vez de checar as
4 origens. Um 401 vindo de qualquer outro módulo durante o uso normal é
tratado no cliente daquele módulo, não no gate de entrada.

## Identidade visual

Direção deliberadamente fora do clichê de dashboard financeiro genérico
gerado por IA — sem gradiente roxo-azul, sem cards com sombra suave
idênticos a todo SaaS, sem ícones de estoque óbvios.

- **Paleta** (`src/index.css`): tinta quase preta + papel quente como
  neutros, terracota (`--primary`) como único acento de ação, um
  verde-musgo (`--positivo`) reservado só para valores positivos/ganho —
  nunca decorativo. Escuro é o padrão; claro fica disponível pelo botão
  de tema na barra lateral (`data-theme="light"`).
- **Tipografia**: Fraunces (serifada, peso alto) só para números e
  títulos de destaque — é o elemento que precisa competir por atenção,
  nunca o texto de apoio. Inter para UI/corpo. IBM Plex Mono para
  tickers, datas e qualquer coluna que precise alinhar.
- **Motion**: só funcional — o indicador de aba ativa desliza com
  `framer-motion` (`layoutId`), sem animação decorativa em cards/números.
- **Cartões**: borda de 1px nítida (`shadow-crisp`), não sombra difusa —
  mais perto de um extrato impresso que de um card flutuante.
- Componentes base em `src/components/`: `ValorMonetario` (formata BRL,
  é sempre o elemento mais forte da tela), `Cartao`, `Botao`,
  `CampoTexto`, `Selecao`, `Selo`. Todos os 4 módulos usam só esses —
  nenhum estilo ad-hoc por módulo.

## Rodando local

```bash
npm install
npm run dev
```

Suba os 4 BFFs localmente nas portas 8020–8023 (ou aponte
`VITE_*_API_URL` para onde estiverem) — sem eles, as telas carregam mas
as chamadas falham com erro de rede, tratado com mensagens inline em vez
de quebrar a tela.

## Build

```bash
npm run build   # tsc -b && vite build -> dist/
```

Em produção, `VITE_*_API_URL` são passadas como variáveis de ambiente do
próprio `npm run build`, mesmo padrão de `tela-frontend`.

## Divergências em relação ao pedido original

- **Motor de grade do dashboard**: em vez de arrastar-e-soltar com
  ponteiro, cada bloco tem controles explícitos (setas para mover,
  +/−/A+/A− para redimensionar) que aparecem no hover do cartão. Cobre
  integralmente "adicionar/remover/redimensionar/reposicionar
  livremente" (FR-041) com bem menos superfície de bug que um motor de
  drag physics do zero, dentro do orçamento desta entrega. Cada alteração
  já persiste via `PUT /api/layout` (dashboard-api) exatamente como
  pedido.
- **Evolução patrimonial**: nenhum dos 4 contratos expõe uma série
  histórica de patrimônio pronta — o bloco calcula um saldo acumulado a
  partir do extrato de transações (`transacional-api`) no período, como
  proxy razoável até existir um endpoint dedicado.
- Categorias de transação (`Alimentação`, `Transporte`, ...) são uma
  lista fixa no frontend (`TransacionalPage.tsx`) — o contrato deixa
  "livre ou pré-definida" como decisão de implementação, e a lista fixa
  facilita agrupar no bloco de "gastos por categoria" do dashboard.
