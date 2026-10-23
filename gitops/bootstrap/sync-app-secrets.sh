#!/bin/bash
# sync-app-secrets.sh — cria/atualiza os Secrets do k8s a partir do ambiente
# REAL dos containers Docker que ainda estão rodando.
#
# Por que derivar em vez de digitar: o container em produção é a fonte da
# verdade do que a aplicação precisa. Copiar o env de lá elimina a classe de
# erro "esqueci uma variável na migração" — que só aparece quando o serviço cai
# em runtime, com o ArgoCD mostrando tudo verde.
#
# Por que não no git: o repositório é PÚBLICO. O manifesto referencia os
# Secrets por nome (`secretKeyRef`/`envFrom`); os valores só existem no cluster.
#
# Idempotente: rodar de novo reaplica os valores atuais. Serve tanto para o
# bootstrap quanto para sincronizar uma rotação de credencial.
#
# Instalação:
#   sudo install -m 755 sync-app-secrets.sh /usr/local/sbin/sync-app-secrets.sh
#
# Uso:
#   sudo sync-app-secrets.sh          # aplica todos
#   sudo sync-app-secrets.sh domain-api   # aplica um
set -uo pipefail

NS="giomartins"
K3S="k3s"

# Variáveis injetadas pela imagem base (Dockerfile/linguagem), não pela
# aplicação: copiá-las para o Secret é ruído — e no caso do nginx elas são
# versões de pacote, que mudariam o hash do Secret a cada rebuild da imagem
# sem nenhuma mudança de configuração.
#
# Os defaults do nginx (`NGINX_VERSION`, `NJS_*`, `PKG_RELEASE`, `DYNPKG_RELEASE`)
# apareceram de fato no primeiro teste: o container é nginx puro, criado por um
# `sh -c` que sobrescreve o entrypoint, então as variáveis da imagem sobrevivem.
IGNORAR='^(PATH|HOSTNAME|HOME|LANG|LANGUAGE|LC_ALL|GPG_KEY|PYTHON_VERSION|PYTHON_SHA256|PYTHONUNBUFFERED|PYTHONDONTWRITEBYTECODE|NODE_VERSION|YARN_VERSION|SSL_CERT_FILE|TERM|NGINX_VERSION|NJS_VERSION|NJS_RELEASE|PKG_RELEASE|DYNPKG_RELEASE)$'

# <nome-do-secret>=<container-docker>[:<chave-que-veio-de-outro-lugar>]
#
# Os segredos são derivados do container homônimo. Quando o nome do container
# difere do serviço no k8s, o mapeamento é explícito.
MAPA=(
  "domain-api:domain-api"
  "domain-worker:domain-worker"
  "finance-api:finance-api"
  "finance-customersupport-worker:finance-customersupport-worker"
  "finance-openfinance-worker:finance-openfinance-worker"
  "vaultwarden-api:vaultwarden-api"
  # O servidor Vaultwarden tem o próprio conjunto de envs (ADMIN_TOKEN com
  # default `${VAR:?}` — ou seja, obrigatório). Sem este secret, o pod do
  # vaultwarden não sobe quando chegar a hora da fatia 6.
  "vaultwarden:vaultwarden"
  # Par do MCP: o servidor carrega DATABASE_URI (senha do usuário read-only
  # mcp_ro) e o gateway carrega MCP_DB_TOKEN, que vira literal no `map` do
  # nginx em tempo de configuração. Dois secrets distintos de propósito: o
  # gateway não deve ver a credencial do banco, nem o MCP o token do gateway.
  "db-mcp:db-mcp"
  "db-mcp-gateway:db-mcp-gateway"
  # Grafana: GF_SECURITY_ADMIN_PASSWORD. O `user: "0"` do Compose e mantido no
  # manifesto, entao nao ha colisao de UID com o volume copiado.
  # Grafana: só as chaves de CONFIGURAÇÃO fazem sentido no pod. A imagem já
  # traz GF_PATHS_* apontando para /etc/grafana, /var/lib/grafana etc., e as do
  # container apontam para os mesmos caminhos por acaso. Copiá-las seria inútil
  # na melhor hipótese, e na pior (se um dia divergirem) quebraria o pod com um
  # caminho inexistente. `:GF_SECURITY_ADMIN_PASSWORD` seleciona uma chave só.
  "grafana:grafana:GF_SECURITY_ADMIN_PASSWORD"
  # 9router: mesmas duas chaves do grafana, mesmo motivo. As outras 10 vars do
  # container (PORT, BASE_URL, DATA_DIR, NODE_ENV...) são configuração, não
  # segredo: ficam literais no manifesto, onde podem ser revisadas no diff.
  # Copiá-las para o Secret as esconderia sem protegê-las, e o pod leria o
  # manifest para descobrir em que porta escuta.
  "9router:9router:JWT_SECRET,INITIAL_PASSWORD"
)

alvo="${1:-}"

for entrada in "${MAPA[@]}"; do
  # Terceiro campo opcional = filtro de chaves, separado por vírgula. Sem ele,
  # copia tudo que não está em IGNORAR (o caso comum: a app precisa do env
  # inteiro). Com ele, copia só o que foi pedido — necessário quando o env do
  # container tem variáveis da imagem que não devem virar env do pod.
  #
  # `read` com 3 variáveis: o que sobra do último separador vai inteiro para a
  # terceira, então o filtro pode conter vírgulas sem quebrar o split.
  IFS=: read -r secret container filtro <<< "$entrada"

  if [ -n "$alvo" ] && [ "$alvo" != "$secret" ]; then
    continue
  fi

  if ! docker inspect "$container" >/dev/null 2>&1; then
    echo "[skip] container $container não existe"
    continue
  fi

  # Monta os --from-literal em um array, sem passar por shell.
  args=()
  qtd=0
  while IFS= read -r linha; do
    [ -z "$linha" ] && continue
    chave="${linha%%=*}"
    valor="${linha#*=}"
    # Ignora as vars da imagem base e as que o Kubernetes injeta sozinho.
    if [[ "$chave" =~ $IGNORAR ]]; then continue; fi
    if [[ "$chave" == *"*"* ]]; then continue; fi
    # Filtro explícito: quando presente, só passam as chaves listadas.
    if [ -n "${filtro:-}" ] && [[ ",$filtro," != *",$chave,"* ]]; then continue; fi
    args+=(--from-literal="${chave}=${valor}")
    qtd=$((qtd+1))
  done < <(docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}')

  if [ "$qtd" -eq 0 ]; then
    echo "[skip] $secret: nenhuma variável aproveitável"
    continue
  fi

  $K3S kubectl create secret generic "$secret" -n "$NS" \
      "${args[@]}" --dry-run=client -o yaml \
    | $K3S kubectl apply -f - >/dev/null

  echo "[ok] secret/$secret <- $container ($qtd chaves)"
done
