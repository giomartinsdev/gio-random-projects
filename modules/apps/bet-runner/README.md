# bet-runner

Worker headless que coloca as apostas: fica em polling no `bet-api`,
reivindica o job mais antigo da fila (`/internal/jobs/claim`), abre um
Chrome furtivo (patchright) com o **perfil persistente da conta**, faz
login se a sessão expirou, preenche o valor e confirma. A casa de
aposta é um **driver** — este serviço não sabe nada específico de
nenhuma delas.

**Roda na rede de casa, não no VPS, e sempre em modo headed sob Xvfb** —
a página de compliance da Betano ("Access to this page is restricted...")
responde ao **browser headless**, não ao IP: ela apareceu tanto do VPS
quanto de um IP residencial em modo headless, e uma corrida headed no
mesmo IP residencial passou limpa. O container por isso roda o Chromium
headed dentro de um display virtual (`xvfb-run` no Dockerfile, `HEADED=1`
no env). Deploy: [`deploy/home/`](./deploy/home/README.md). No VPS não
sobra nada deste serviço (o módulo terraform foi removido); `/internal/*`
do bet-api continua autenticado só pelo `RUNNER_API_KEY`.

## Arquitetura

```
src/index.ts           loop principal: claim → run → report → sleep
src/lib/bff.ts         cliente do /internal/* do bet-api (X-Runner-Key)
src/lib/browser.ts     patchright: contexto persistente por (vendor, user)
src/vendors/types.ts   BookmakerDriver — o contrato de uma casa
src/vendors/betano.ts  o driver da Betano (seletores + fluxo)
src/vendors/index.ts   registro vendor → driver
src/lib/stake.ts       centavos ↔ string "10,50" pt-BR
```

Fluxo de um job (todos os passos viram `receipt.steps` no histórico):

1. claim no BFF (bet + credenciais decriptadas, só em memória);
2. Chrome headed (Xvfb) com `userDataDir=/data/profiles/<vendor>/<userId>`
   — login sobrevive entre execuções;
3. abre o link → espera challenge do Cloudflare se aparecer;
4. fecha os modais interceptores de clique que a casa soltar (verificação
   de idade, confirmação de booking code, cookies — lista `MODAL_DISMISS`
   no driver);
5. login só se o formulário ou o CTA de "entrar" estiverem na tela;
6. slip pré-preenchido? senão, clica na primeira odd;
7. preenche o valor (pt-BR, `10,50`), screenshot **antes** do clique final;
8. `DRY_RUN=1` → para aqui (receipt marca `dryRun: true`);
9. clique de confirmação → espera texto de confirmação do site →
   screenshot final + saldo, se legível.

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `BET_API_URL` | — | obrigatória. Base do bet-api — hostname público de casa (`https://bet-api.giomartins.dev`), interno na rede docker (`http://bet-api:8009`). |
| `RUNNER_API_KEY` | — | obrigatória. Mesmo valor do bet-api (header `X-Runner-Key`). |
| `PROFILES_DIR` | `/data/profiles` | raiz dos perfis de navegador persistentes. |
| `POLL_INTERVAL_MS` | `5000` | intervalo de polling quando a fila está vazia. |
| `BET_TIMEOUT_MS` | `180000` | teto de tempo por aposta (o driver tem timeouts internos). |
| `DRY_RUN` | `1` | **`1` = nunca clica no botão final** (padrão seguro). Produção seta `0` explicitamente. |
| `HEADED` | `0` | `1` = browser headed — **obrigatório contra a Betano** (a parede de compliance responde a headless; o container de casa roda com `HEADED=1` sob Xvfb, ver Dockerfile). Local sem display só com `0`. |
| `LOG_LEVEL` | `info` | `debug` mostra cada tentativa de seletor. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | vazio | sem valor = telemetria desligada. |

## Rodar local

```bash
npm install
npx patchright install chromium   # baixa o Chromium patcheado
npm run dev                       # precisa de bet-api no ar
```

Depurar seletores de verdade: `DRY_RUN=1 HEADED=1 npm run dev` com uma
aposta na fila, ou `npx patchright open <link-da-betano>` e inspecionar
o DOM à mão. O screenshot do receipt mostra exatamente onde o fluxo
parou.

## Adicionar uma casa nova (bet365 etc.)

1. `src/vendors/bet365.ts`: copie a estrutura do `betano.ts` — seletores
   como dados no topo, fluxo no `placeBet`. Não reutilize seletores de
   outra casa; o fluxo (login/slip/confirmação) muda por site.
2. Registre em `src/vendors/index.ts`.
3. Adicione os hostnames da casa em `bet-api/src/lib/vendors.ts` (o BFF
   resolve o vendor pelo domínio do link; o runner nunca re-resolve).
4. Teste com `DRY_RUN=1` antes de qualquer aposta real.

## Notas de produção

- Um job por vez, sequencial — o mesmo perfil nunca abre em paralelo
  (lock do Chrome) e o comportamento parece humano.
- Chrome em container precisa de /dev/shm real (`shm_size: 512m` no
  compose de casa; era var do módulo terraform).
- Se um report falhar 5 vezes o bet fica "running" no BFF — corrija na
  mão com `UPDATE bet_bets SET status='failed', error='runner perdeu o
  report' WHERE id=...;` (o BFF só aceita resultado de bet running).
- Automação de casa de aposta viola os termos de uso da maioria delas —
  uso pessoal, conta própria, uma aposta por vez, sem retry automático.