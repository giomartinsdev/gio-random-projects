#!/bin/bash
# checa-profiles.sh — quais servicos o `docker compose up -d` do Dockhand VAI
# subir, ou seja: os que NAO tem `profiles: ["retired"]`.
#
# ## Por que isso importa
#
# O Dockhand roda, nos stacks 21 e 22, `docker compose -p ... up -d
# --remove-orphans --force-recreate --pull always` — SEM `--profile`. Um
# servico so fica de fora se ele mesmo declarar `profiles: ["retired"]`.
# `restart: "no"` nao ajuda: ele rege crash/reboot, nao o `up` explicito.
# Ver armadilha 36 no gitops/README.md.
#
# ## Como ler a saida
#
# ESPERADO — estes devem continuar em Docker:
#   maus.yml       omb, caddy, slack-bridge        (nao migrado, decisao)
#   minecraft.yml  minecraft, mc-backup            (fora de escopo)
#   core.yml       registry*, ingress, dockhand    (morrem com o Docker)
#
# QUALQUER outro nome e um servico MIGRADO que vai ressuscitar as 03:00 UTC
# e disputar porta com o pod. `include:` nao herda profile: ele precisa
# estar no bloco do servico, no arquivo-folha.
#
# Uso: gitops/bootstrap/checa-profiles.sh [dir]     (default: stacks)
set -uo pipefail

DIR="${1:-stacks}"
[ -d "$DIR" ] || { echo "diretorio nao encontrado: $DIR" >&2; exit 1; }

ESPERADOS="omb caddy slack-bridge minecraft mc-backup registry-htpasswd registry-docker-config registry ingress dockhand network-init 9router decision"

SAIDA=$(mktemp)
trap 'rm -f "$SAIDA"' EXIT

for f in "$DIR"/*.yml; do
  [ -f "$f" ] || continue
  # `container_name` distingue servico de volume/network (que nunca tem).
  # yq sai 0 e vazio quando o arquivo so tem `include:`.
  #
  # Sem pipe para `while`: o subshell do pipe perderia as escritas em $SAIDA.
  servicos=$(yq -r '
    (.services // {}) as $s
    | $s | to_entries[]
    | select(.value.container_name != null)
    | select((.value.profiles // []) | contains(["retired"]) | not)
    | .key
  ' "$f" 2>/dev/null)
  for svc in $servicos; do
    echo "${f#"$DIR"/}: $svc" >> "$SAIDA"
  done
done

SORTEADA=$(sort "$SAIDA")
echo "=== sobem no 'up' das 03:00 UTC (sem profiles: retired) ==="
echo "$SORTEADA" | sed 's/^/  /'

INESPERADOS=""
while IFS= read -r linha; do
  [ -n "$linha" ] || continue
  svc="${linha##*: }"
  caso=0
  for e in $ESPERADOS; do [ "$svc" = "$e" ] && caso=1; done
  [ "$caso" = "0" ] && INESPERADOS="$INESPERADOS
  $linha"
done <<< "$SORTEADA"

echo
if [ -n "$INESPERADOS" ]; then
  echo "FALHA: migrado(s) sem a trava, vai(ão) voltar e brigar por porta:"
  echo "$INESPERADOS"
  exit 1
fi

echo "OK: todos os que sobem sao os esperados (maus, minecraft, core)."
