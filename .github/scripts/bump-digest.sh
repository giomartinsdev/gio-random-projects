#!/usr/bin/env bash
# bump-digest.sh — grava no git o digest que o CI acabou de publicar.
#
# ## Por que isto existe
#
# Todo manifesto em `gitops/apps/` fixa **digest**, não tag:
#
#     image: registry.giomartins.dev:5000/domain-api@sha256:f5952031...
#
# Fixar digest é a escolha certa (imutável, e é o que impede "upgrade de
# versão" acidental no meio de outra mudança). Mas isso deixa um buraco que
# ficou aberto desde a migração: o CI publicava `:latest` no registry e
# chamava o webhook do Dockhand, que só mexe em **Docker**. Nenhum passo
# escrevia o digest novo no manifesto — então o pod continuava na imagem
# velha, para sempre, com o CI verde.
#
# Medido em 2026-10-24, antes de corrigir: `tela-api` rodava
# `@sha256:91f313c4...` enquanto o `:latest` no registry era
# `@sha256:52326c1d...`. O drift já tinha acontecido.
#
# Este script fecha o buraco: o CI publica, resolve o digest, reescreve a
# linha do manifesto e commita. O ArgoCD (auto-sync + selfHeal) aplica.
# Sem Dockhand, sem `compose up`, sem Docker.
#
# ## Uso
#
#   ./bump-digest.sh <app> <digest>
#
# Ex.: ./bump-digest.sh domain-api sha256:52326c1d3002...
#
# Sai com 0 quando não há nada a fazer (digest já é o do manifesto) — o
# workflow não deve falhar por isso.
set -euo pipefail

: "${1:?uso: bump-digest.sh <app> <digest>}"
APP="$1"
DIGEST="$2"

case "$DIGEST" in
  sha256:*) ;;
  *) echo "digest invalido: $DIGEST" >&2; exit 2 ;;
esac

REGISTRY_HOST="registry.giomartins.dev:5000"

# Um app pode aparecer em mais de um manifesto (hoje: nenhum — mas o
# `domain-api` é citado em comentário no manifesto do registry, por isso o
# filtro exige `image:` no começo da linha). Sem este filtro, um comentário
# casaria e o script reescreveria texto.
#
# `while read` em vez de `mapfile`: o bash 3.2 do macOS (o script roda no
# runner E na mão) não tem `mapfile`.
FILES=$(grep -rl "^[[:space:]]*image: ${REGISTRY_HOST}/${APP}@" gitops/apps --include='*.yaml' 2>/dev/null || true)

if [ -z "$FILES" ]; then
  echo "::error::nenhum manifesto referencia ${REGISTRY_HOST}/${APP}@sha256:..."
  echo "Se o app é novo, crie o manifesto antes de habilitar o bump."
  exit 1
fi

CHANGED=0
# `IFS` com newline: nomes de arquivo do repo não têm espaço, e isso evita
# depender de arrays (bash 3.2 do macOS não tem `mapfile`).
OLDIFS="$IFS"; IFS='
'
for f in $FILES; do
  IFS="$OLDIFS"
  [ -n "$f" ] || continue
  if grep -q "${REGISTRY_HOST}/${APP}@${DIGEST}\b" "$f"; then
    echo "  $f já está em ${DIGEST:0:19}..."
    continue
  fi
  echo "  $f: atualizando para ${DIGEST:0:19}..."
  # `perl -pi` em vez de `sed -i`: o BSD sed do macOS e o GNU sed do runner
  # têm sintaxes de `-i` diferentes, e este script roda nos dois.
  #
  # `\@` NÃO é decoração: em Perl, dentro de string com aspas duplas, `@sha256`
  # é interpolado como ARRAY (nome de array válido) e vira string vazia — o
  # regex deixa de casar e o script "funciona" sem mudar nada. Custou um teste
  # descobrir isso.
  perl -pi -e "s|(${REGISTRY_HOST}/${APP})\@sha256:[0-9a-f]{64}|\$1\@${DIGEST}|g" "$f"
  CHANGED=1
  IFS='
'
done
IFS="$OLDIFS"

if [ "$CHANGED" -eq 0 ]; then
  echo "nada a fazer (digest já é o do manifesto)"
  exit 0
fi

# Só PREPARA (`git add`); o commit é do workflow, um por run. Uma matrix com
# 3 apps não deve gerar 3 commits (e 3 pushes concorrentes em `main`).
# `$FILES` é lista separada por newline — a expansão de palavra é o que se
# quer aqui (e o shellcheck avisa).
# shellcheck disable=SC2086
git add $FILES
echo "preparado"
