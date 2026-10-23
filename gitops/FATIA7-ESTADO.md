# Fatia 7 — fechada

Data: 2026-10-23. Namespace `giomartins` fatiado em `persistence`,
`observability`, `applications`, `support`.

## Estado final: 15/15 Synced, 14 Healthy

Namespace `giomartins` **apagado** em 2026-10-23 20:55 UTC, depois de provado que
nada dependia dele. Backup dos manifests em
`/opt/k8s-backups/2026-10-23-2055-giomartins-final/` (mode 600).

| namespace | serviços | PVCs rebindados |
| --- | --- | --- |
| `persistence` | `postgres`, `rabbitmq`, `minio`, `vaultwarden`, `evolution-redis` | 5 |
| `observability` | `prometheus`, `loki`, `tempo`, `grafana`, `alloy-logs` | 4 |
| `applications` | `domain` (api+worker), `finance` (3), `evolution-api`, `vaultwarden-api`, `9router`, `excalidraw` | 1 |
| `support` | `adminer`, `db-mcp`, `db-mcp-gateway`, `dns-aliases` | 0 |

**10 PVs rebindados sem copiar um byte.** Cada um com `volumeName` idêntico ao
original. Zero PV órfão: `PVs ainda apontando para giomartins: 0`.

O único `Progressing` é `9router`, com `replicas: 0` de propósito — é o gateway
da sessão e o cutover exige janela manual.

## Testemunhas medidas no fim

| serviço | prova |
| --- | --- |
| postgres | `finance_transactions` = **1178** (era 1176 antes da janela — escritas novas passando), 17 tabelas |
| evolution-api | instância `web-businesses` **`open`**, `CONNECTED TO WHATSAPP`, **0** `redis disconnected`, sem QR novo |
| evolution (schema) | 983 mensagens, 103 contatos, 4 chats |
| evolution-redis | chave `evolution:instance:4b81fda4-…` intacta (db 6) |
| rabbitmq | **1 consumer por fila**, sem duplicação |
| alloy → tempo | `receiver_accepted_spans` = `exporter_sent_spans` = 243 |
| alloy → loki | `sent_entries_total` crescendo; logs de 13 s atrás |

## Portas públicas pelo caminho real (Cloudflare → nginx do host)

O caminho externo **não** passa pelo `ingress-nginx` do cluster: é o nginx em
Docker no host, que faz `proxy_pass` para `127.0.0.1:<NodePort>`. Das 19 portas
que ele referencia, **todas respondem** (nenhum `000`):

```
30800 domain        404      30901 minio        200      30023 draw       200
30822 vault         200      30092 adminer      200      30818 fin-api    404
8093  dockhand      307      30300 grafana      302      30418 otel       404
8007  tela-api      404      30672 rabbit       200      20128 ai         307
30808 evolution     200      8799  maus         200      30900 tela/hub/
30821 db-mcp        401      31844 rancher      400            finance   403
```

`404`/`403`/`400` são respostas de aplicação viva, não de proxy quebrado.
Nenhum 5xx.

> **A regra "o NodePort não muda" é o que preservou os 24 hosts.** O contrato
> entre o nginx do host e o cluster é só `host:porta`.

## As cinco armadilhas que esta janela ensinou

Detalhadas no `README.md`, armadilhas 18 a 22.

1. **Todo cliente guarda o ClusterIP.** `ioredis` nunca re-resolve; `amqplib`
   re-resolve sozinho; o resolver gRPC guardou uma resolução vazia. Alias de DNS
   não conserta conexão aberta — só restart do consumidor.
2. **`apply -f` em manifesto cru ignora o `namespace:`** (ele vive no
   `kustomization.yaml`). Isso criou um Redis **novo e vazio** em `default`,
   "saudável" ao lado do real.
3. **Detector de PVC que falha em silêncio.** `awk` com `^` em buffer
   multi-linha não casa. O Postgres subiu com **0 tabelas**; restaurado no PV
   original sem perda.
4. **Contagem de arquivos é testemunha ruim.** O Loki compacta ao fechar
   (5092 → 5090) e abortou a janela; `evolution-instances` sempre foi vazio
   (0 bytes) e a guarda de "vazio = perda" também abortou. A testemunha certa é
   **variação de bytes**.
5. **Esperar `Ready` antes do Service trava dependência intra-namespace**, e a
   fase 5 apagava o Deployment antigo mesmo quando a fase 4 falhava — o antigo
   **é** o rollback. A produção do `db-mcp-gateway` caiu por minutos.

## O que sobrou em `giomartins`

**Nada.** O namespace foi apagado às 20:55 UTC de 2026-10-23, depois de:

- 16/16 Secrets provados **idênticos** aos dos namespaces novos (hash do conjunto
  chave+valor, sem imprimir valor);
- **zero** referências a `giomartins.svc` em Service, ConfigMap, Secret ou
  Deployment de qualquer namespace;
- **zero** PVs com `claimRef` para lá;
- nenhum pod, Deployment, PVC, CronJob ou EndpointSlice órfão.

O timer `sync-external-endpoints` **continua rodando** a cada minuto com
`MAPA=()` — não recria nada. Fica instalado de propósito: é o mecanismo de
rollback de emergência caso um Service de ponte precise voltar. Com o Docker
desligado, o loop não tem em que tocar.

Os manifests (19 Services, 16 Secrets, ConfigMap, ServiceAccount) estão em
`/opt/k8s-backups/2026-10-23-2055-giomartins-final/giomartins.yaml`, mode 600.
Recriar o namespace é `kubectl apply` desse arquivo.

## Pendências

1. ~~Apagar `giomartins`~~ — feito.
2. ~~Rotacionar as senhas de Kubero e ArgoCD~~ — **feito e provado**. Ver abaixo.
3. Débitos registrados, não endereçados: senha do usuário `mcp_ro`,
   `rancher.giomartins.dev` público (HTTP 400 na porta `31844`), dupla ingestão
   de logs.

## Rotação de senhas (2026-10-23 21:00 UTC)

| | Kubero | ArgoCD |
| --- | --- | --- |
| onde mora | SQLite `User.password` | Secret `argocd-secret/admin.password` |
| hash | bcrypt `$2b$10$` | bcrypt `$2a$10$` |
| novo login provado | `POST /api/auth/login` → `access_token` | `POST /api/v1/session` → `token` (257 chars) |
| senha errada rejeitada | `403` | `401` |
| hash mudou | sim (`bcrypt.compare` = true) | sim (diff contra backup) |

Descoberta que teria feito a rotação falhar em silêncio: **`KUBERO_ADMIN_PASSWORD`
não existe em `kubero-secrets`**. O Deployment o referencia, mas o admin do
Kubero v3.1.1 é semeado no SQLite na primeira subida (log: `No legacy users to
migrate. KUBERO_USERS is not set.`). Trocar a env não teria efeito nenhum.

`argocd-initial-admin-secret` foi apagado — só vale até o primeiro login e
manter uma credencial válida num Secret morto é risco sem contrapartida.

Senhas novas em `/opt/k8s-backups/senhas-20261023-2100/{kubero,argocd}-admin.txt`,
mode 600. Estado anterior (para rollback) no mesmo diretório.

## O que **não** foi feito, de propósito

- `9router`: `replicas: 0` — gateway da sessão, cutover manual.
- `maus` (docker.sock + `/data` do host) e `tela-*` (hostNetwork + UDP): exigem
  redesenho, não migração.
- `ingress-nginx` (EOL): dívida registrada; não migrado para Traefik.
