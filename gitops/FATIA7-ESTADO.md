# Fatia 7 — fechamento

Data: 2026-10-23, ~20:50 UTC. Namespace `giomartins` fatiado em
`persistence`, `observability`, `applications`, `support`.

## Estado final

Os 15 serviços saíram de `giomartins`. O que sobrou lá são **19 aliases de
transição** (`ExternalName`) e um PVC Pending morto — nada serve tráfego.

| namespace | serviços | PVCs rebindados |
| --- | --- | --- |
| `persistence` | `postgres`, `rabbitmq`, `minio`, `vaultwarden`, `evolution-redis` | 5 |
| `observability` | `prometheus`, `loki`, `tempo`, `grafana`, `alloy-logs` | 4 |
| `applications` | `domain` (api+worker), `finance` (3), `evolution-api`, `vaultwarden-api`, `9router`, `excalidraw` | 1 |
| `support` | `adminer`, `db-mcp`, `db-mcp-gateway` | 0 |

**10 PVs rebindados sem copiar um byte**, cada um com `volumeName` idêntico ao
original. Nenhum dado perdido.

## Testemunhas medidas no fim

| serviço | prova |
| --- | --- |
| postgres | `finance_transactions` = **1176**, 17 tabelas, 2.582.325 tuplas |
| evolution-api | instância `web-businesses` **`open`**, **`CONNECTED TO WHATSAPP`**, sem QR novo |
| evolution (schema) | 983 mensagens, 103 contatos, 4 chats |
| evolution-redis | chave `evolution:instance:4b81fda4-…` presente (db 6) |
| rabbitmq | **1 consumer por fila** (sem duplicação), `domain.events.queue` estável em 2343 |
| alloy → tempo | `receiver_accepted_spans` = `exporter_sent_spans` = 243 |
| alloy → loki | `loki_write_sent_entries_total` crescendo; logs de 13 s atrás |
| adminer | HTTP **200** em `:30092` |
| db-mcp-gateway | HTTP **401** em `:30821` (auth exigida = serviço no ar) |
| excalidraw | HTTP **200** em `:30023` |
| vaultwarden-api | `vaultwarden:80 ABERTO` pelo alias |

## As cinco armadilhas que esta janela ensinou

Registradas em detalhe no `README.md` (18 a 22).

1. **Todo cliente guarda o ClusterIP.** `ioredis` nunca re-resolve; `amqplib`
   re-resolve sozinho; o resolver gRPC guardou resolução vazia. Alias de DNS não
   conserta cliente com conexão aberta — só restart.
2. **`apply -f` em manifesto cru ignora o `namespace:`.** Vive no
   `kustomization.yaml`. Aplicar cru criou um Redis **novo e vazio** em
   `default`, "saudável" ao lado do real.
3. **Detector de PVC que falha em silêncio.** `awk` com `^` em buffer
   multi-linha não casa. O Postgres subiu com **0 tabelas** e o script disse
   "sem PVC". Restaurado no PV original.
4. **Contagem de arquivos é testemunha ruim.** O Loki compacta ao fechar
   (5092 → 5090) e abortou a janela. `evolution-instances` sempre foi vazio
   (0 bytes) e a guarda de "vazio = perda" também abortou. A testemunha certa é
   **variação de bytes**.
5. **Esperar `Ready` antes do Service trava dependência intra-namespace.**
   `db-mcp-gateway` (nginx) resolve `db-mcp` no start. Pior: a fase 5 apagava o
   Deployment antigo mesmo quando a fase 4 falhava — e o antigo **é** o rollback.
   Produção do gateway caiu por minutos (`HTTP 000`).

## Pendências para fechar

1. **Enviar o repo** (`6622ce3` está local; o ArgoCD lê do GitHub).
2. Aplicar `gitops/bootstrap/appset.yaml` no cluster.
3. Descongelar `argocd-applicationset-controller` e
   `argocd-application-controller`.
4. Conferir 15 Applications `Synced` nos paths novos.
5. Apagar os 19 aliases de transição de `giomartins` e o namespace, quando o
   ArgoCD estiver verde.
6. Rotacionar as senhas de Kubero e ArgoCD (decisão do usuário).

## O que **não** foi feito, de propósito

- `9router` está com `replicas: 0` — é o gateway da sessão, cutover exige
  parada manual.
- `maus` (docker.sock + `/data` do host) e `tela-*` (hostNetwork + UDP) não
  foram movidos: exigem redesenho, não migração.
- `ingress-nginx` (EOL) segue como dívida registrada; não migrado para Traefik.
