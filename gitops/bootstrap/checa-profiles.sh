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
#   core.yml       dockhand                        (UI do Docker, morre com ele)
#
# `maus` e `minecraft` SAIRAM em 2026-10-24, descomissionados (parados +
# `profiles: retired`). Antes eles eram a excecao legitima; agora sao mais
# dois migrados-aposentados. Se um dia voltarem, e so remover a trava.
#
# Com isso, `project-apps` e `project-infra` ficam AMBOS sem servico vivo.
# Ver divida 19: `no service selected` sai com exit 1.
#
# QUALQUER outro nome e um servico MIGRADO que vai ressuscitar as 03:00 UTC
# e disputar porta com o pod. `include:` nao herda profile: ele precisa
# estar no bloco do servico, no arquivo-folha.
#
# ## O furo que isto fechou (2026-10-24)
#
# O script varria TODOS os stacks/*.yml, inclusive os que nenhuma stack
# inclui. `ai.yml` nao e incluido por ninguem (ver a nota em
# project-infra.yml), mas o `9router` dele aparecia na saida como se fosse
# subir -- e estava na whitelist, entao passava. O `9router` do `compute.yml`
# e o que realmente existe, e esse ja tem a trava desde dfd597f.
#
# `core.yml` mudou no mesmo dia: `registry`, `ingress` e os dois one-shots
# ganharam `profiles: ["retired"]` quando seus volumes externos foram
# removidos. Sem a trava, o `up` abortava com "external volume not found" --
# e um volume externo faltando derruba o PROJETO inteiro, nao so o servico.
# O unico que sobe em `core.yml` agora e o `dockhand`.
#
# Uso: gitops/bootstrap/checa-profiles.sh [dir]     (default: stacks)
set -uo pipefail

DIR="${1:-stacks}"
[ -d "$DIR" ] || { echo "diretorio nao encontrado: $DIR" >&2; exit 1; }

# 9router/decision sairam: o `ai.yml` nao e incluido por nenhuma stack, e o
# `9router` do `compute.yml` ja tem a trava desde dfd597f. Se o `ai.yml` for
# habilitado um dia, estes dois voltam -- mas entao o `9router` do
# `compute.yml` precisa sair, senao brigam pela mesma porta e pelo mesmo volume.
ESPERADOS="dockhand network-init"

SAIDA=$(mktemp)
trap 'rm -f "$SAIDA"' EXIT

# ## Quais arquivos o Dockhand REALMENTE executa
#
# Nao e "todos os .yml": e o `compose_path` de cada stack com
# `auto_update=1` no banco do Dockhand. Hoje sao dois (`project-infra.yml` e
# `project-apps.yml`), e cada um herda os arquivos por dominio via `include:`.
#
# Varrer o diretorio inteiro dava falso negativo: um servico migrado num
# arquivo que ninguem inclui (`ai.yml`) aparecia na saida e passava pela
# whitelist. Pior, mascarava o caso oposto -- um arquivo incluido podia
# ganhar servico novo sem o gate olhar.
RAIZES="project-infra.yml project-apps.yml minecraft.yml core.yml"

# Resolve `include:` recursivamente. Sem isto, `project-infra.yml` sozinho nao
# tem servico nenhum (so include) e o gate nao veria nada.
resolver() {
  local arq="$1"
  [ -f "$arq" ] || return 0
  echo "$arq"
  # `include:` e lista simples de caminhos relativos ao proprio arquivo.
  # Só a forma `- nome.yml` interessa aqui (a forma com `path:` nao e usada).
  grep -E '^[[:space:]]*-[[:space:]]+[^#]*\.ya?ml[[:space:]]*$' "$arq" 2>/dev/null \
    | sed -E 's/^[[:space:]]*-[[:space:]]+//; s/[[:space:]]*$//' \
    | while IFS= read -r inc; do
        resolver "$(dirname "$arq")/$inc"
      done
}

ARQUIVOS=$(for r in $RAIZES; do resolver "$DIR/$r"; done | sort -u)

echo "=== arquivos que o Dockhand executa (via include) ==="
echo "$ARQUIVOS" | sed 's/^/  /'
echo

for f in $ARQUIVOS; do
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
