# Cloudflare na frente de tudo (Fase 2) — decisões e incidentes

Estado em agosto/2026: todos os hostnames de `locals.tf` estão
**orange-cloud** (proxied) na Cloudflare, **exceto**
`registry.giomartins.dev`. TLS real termina na edge; a origem continua
HTTP puro na :80 (ingress nginx). As camadas de borda (Access, service
tokens, WAF do registry) já estavam codificadas e armarão sozinhas com
o flip — nada foi criado novo para isso.

Implementação: `modules/cloud/cloudflare/dns.tf` (`proxied` +
`direct_hostnames` em `locals.tf`) e `zone_settings.tf`.

## Por que o registry fica cinza

CI (`go-ci-cd.yml`/`ts-ci-cd.yml`) faz `docker push` e watchtower faz
pull em `registry.giomartins.dev:5000` — HTTP puro. A Cloudflare só
proxya portas específicas (80/443/8080…); **5000 não está na lista**.
Com registro laranja, os clients docker resolveriam para os IPs da
edge, onde :5000 não existe — todo deploy quebraria. O registry mantém
o próprio htpasswd; a maquinaria de mTLS (`registry_mtls.tf`) fica
dormante enquanto o record for grey (só dispara em tráfego que passa
pela proxy).

Detalhe técnico: records proxied têm TTL normalizado para `1` pela API
de qualquer valor enviado — enviar outro é diff perpétuo no plan. Por
isso o ternário no `ttl`.

## Modo SSL da zona = flexible (obrigatório nesta arquitetura)

`zone_settings.tf` fixa `ssl = "flexible"` via
`cloudflare_zone_setting` (sintaxe v5 — o `zone_settings_override` do
v4 está deprecado).

- `flexible`: edge → origem na **:80**, onde o ingress escuta. ✓
- `full`/`strict`: edge → origem na **:443** — não há listener lá.

### Incidente 521 (26/08/2026)

O flip da Fase 2 deixou tudo 521 ("web server is down"). Causa: o modo
SSL da zona estava `full`, herdado do servidor antigo que tinha cert na
origem — a edge discava :443, encontrava connection refused (o listener
temporário de emergência havia sido revertido) e reportava origem morta.
Origem estava saudável o tempo inteiro (:80 respondia 200). Fix: pinar
`flexible`; apply direto na main resolveu.

Hardening futuro (deliberadamente não feito): Cloudflare Origin CA +
listener :443 no ingress + modo `strict` criptografaria a perna
edge→origem. Exige token com permissão Origin CA Edit e migração própria.

## Antes do flip: "vault/beszel não abrem" no navegador

Sintoma pré-Fase 2: os sites respondiam 200 via `curl` mas travavam no
Chrome/celular. Causa: **HTTPS-first dos navegadores** — digitando só
`vault.giomartins.dev`, o browser tentava :443 (que não existia na
Fase 1), pendurava até timeout e não caía para HTTP (HSTS/cache das
tentativas anteriores). Era problema de cliente, não de servidor — por
isso o teste honesto é sempre `curl -H 'Host: …' http://IP/`. Com o
flip, `https://` funciona de verdade e a classe de problema acabou.

## Efeito colateral desejado: Access armado

Com os records laranja, passam a valer as aplicações Access já geridas
por `access.tf`: Google SSO na frente de beszel/vault/minio/adminer;
`domain.giomartins.dev` com app de service-token (sem redirect);
excluídos (`post/bookclub/classroom-api`, front, tela, ai) passam
direto. Primeira visita a um hostname protegido pede login Google — é
a camada externa, não um bug.
