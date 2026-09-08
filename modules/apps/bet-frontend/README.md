# bet-frontend

Micro frontend do sistema de apostas: cola o link da bet, escolhe
unidades, acompanha a fila. React 19 + Vite + Tailwind, mesmo esqueleto
do cch-frontend (sem router — três abas por hash), servido do MinIO
como os outros SPAs do hub.

## Abas

- **Apostar** — link + unidades + preview do valor (unidades × valor da
  unidade). Execução direta: entra na fila do bet-api.
- **Histórico** — últimas 50 apostas, polling de 3s enquanto houver
  fila/execução; receipt (passos + screenshot base64, se houver) do
  runner.
- **Ajustes** — valor da unidade, credenciais por casa (cifradas em
  repouso no bet-api), logout.

## Auth

Toda autenticação é do Cloudflare Access — a aplicação Access fica na
frente de `bet-api.giomartins.dev` (Google, emails permitidos no
Terraform). Aqui:

- `lib/api.ts` `probeMe()`: `GET /api/me` com `redirect:"manual"` +
  `credentials:"include"` — 200 = logado, opaco (status 0) = não.
- `goToSso()`: navegação top-level para `bet-api/auth/sso` (o Google
  não roda dentro de iframe/fetch) — sessão do team compartilhada com o
  hub.
- `logout()`: endpoint de logout do team Access.

## Dev

```bash
npm install
npm run dev      # :5173, proxy /api e /auth → localhost:8009 (bet-api)
```

`VITE_BET_API_URL` é injetado no build de CI (produção); em dev fica
vazio e o proxy do vite resolve. Tema sincroniza com o hub via
postMessage (`lib/hubTheme.ts`), igual aos outros micro apps.