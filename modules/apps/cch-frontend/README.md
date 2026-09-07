# cch-frontend

A página em `cch.giomartins.dev` — cartas contra a humanidade. SPA
React estática, mesmo modelo do [`tela-frontend`](../tela-frontend/README.md):
não roda como container — o build (`dist/`) é espelhado direto num
bucket do MinIO, e `compute/services/ingress` serve esse bucket pela
API S3 do MinIO (veja `modules/infra/terraform/static_sites.tf`). Toda
a lógica de jogo (salas, partidas, cartas) mora em
[`cch-api`](../cch-api/README.md), um app separado que esta fala por
CORS + WebSocket (`VITE_CCH_API_URL`, ver `src/lib/api.ts`).

## Rodando local

```bash
npm install
npm run dev
```

`vite.config.ts` proxia `/api` e `/ws` para `http://localhost:8008` —
suba `cch-api` (`go run .` na pasta dela) nessa porta e não precisa
setar `VITE_CCH_API_URL` nenhuma pra desenvolver local.

## Build

```bash
npm run build   # tsc -b && vite build -- gera dist/
```

Em produção, `VITE_CCH_API_URL` (`https://cch-api.giomartins.dev`) é
passado como variável de ambiente do próprio `npm run build` — veja
`.github/workflows/ts-frontend-ci-cd.yml`.