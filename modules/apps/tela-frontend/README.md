# tela-frontend

A página em `tela.giomartins.dev` — SPA React estática, servida por
nginx, sem runtime Node em produção (mesmo padrão de `modules/apps/front`).
Toda a lógica de sinalização/SFU/salas mora em
[`tela-api`](../tela-api/README.md), um app separado que esta fala por
CORS (`VITE_TELA_API_URL`, ver `Dockerfile` e `src/lib/api.ts`).

## Rodando local

```bash
npm install
npm run dev
```

`vite.config.ts` proxia `/api` e `/ws` para `http://localhost:8000` —
suba `tela-api` (`go run .` na pasta dela) nessa porta e não precisa
setar `VITE_TELA_API_URL` nenhuma pra desenvolver local.

## Build

```bash
npm run build   # tsc -b && vite build -- gera dist/
```

Em produção, `VITE_TELA_API_URL` (ex: `https://tela-api.giomartins.dev`)
é passado como build-arg no `Dockerfile` — veja
`.github/workflows/ts-frontend-ci-cd.yml`.
