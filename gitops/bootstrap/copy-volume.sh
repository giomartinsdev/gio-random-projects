#!/bin/bash
# copy-volume.sh — copia um volume Docker para o diretório de um PVC do k8s.
#
# Chamava-se `copy-obs-volume.sh` enquanto só a observabilidade migrava. Virou
# `copy-volume.sh` na fatia 5, quando o primeiro volume de DADO (minio) passou a
# usar o mesmo procedimento. O nome antigo continua como wrapper.
#
# ## O que este script NÃO faz
#
# Não decide se a parada é segura, e não valida o conteúdo copiado. As duas
# coisas são do operador, e são justamente as que dão errado. Ele existe para
# não errar o caminho do PVC (que contém o uid) e para garantir a ordem
# parar → copiar → religar.
#
# ## O procedimento, e por que nesta ordem
#
#   1. parar o container Docker   (fonte consistente: WAL fechado)
#   2. copiar _data/. -> PVC      (destino vazio, filler não abre nada)
#   3. religar o container Docker (o stack antigo volta a servir)
#
# O container é religado ANTES de o pod subir. Assim, se a cópia tiver sido
# ruim, o serviço antigo continua atendendo e nada foi perdido — o pod só
# assume depois de provar que lê o dado copiado.
#
# ## Por que `cp -a` e não `rsync`
#
# `rsync` não está instalado no host. `cp -a` preserva modo, dono e timestamps,
# que é o que importa aqui: os processos rodam como root (runAsUser 0), e os
# arquivos copiados vêm de um volume do mesmo dono.
#
# ## Uso
#
#   sudo ./copy-volume.sh <serviço>
#
# O caminho do PVC é lido do PV em vez de montado à mão porque ele contém o uid
# do PVC — um uuid que muda a cada recriação. Montar a string daria um caminho
# inexistente, e `cp` criaria um diretório novo, silenciosamente vazio.
set -uo pipefail

SVC="${1:?uso: $0 <servico>}"

case "$SVC" in
  prometheus) VOL="obs_prom_data";  PVC="prometheus-data" ;;
  loki)       VOL="obs_loki_data";  PVC="loki-data" ;;
  tempo)      VOL="obs_tempo_data"; PVC="tempo-data" ;;
  grafana)    VOL="obs_grafana_data"; PVC="grafana-data" ;;
  minio)      VOL="apps_minio_data"; PVC="minio-data" ;;
  evolution-api) VOL="evolution_instances"; PVC="evolution-instances" ;;
  *) echo "serviço desconhecido: $SVC" >&2; exit 1 ;;
esac

ORIGEM="/var/lib/docker/volumes/${VOL}/_data"

DESTINO=$(k3s kubectl get pv -o jsonpath="{range .items[*]}{.spec.claimRef.name}{\" \"}{.spec.local.path}{\"\n\"}{end}" \
          | awk -v p="$PVC" '$1==p {print $2}')

if [ -z "$DESTINO" ]; then
  echo "erro: não achei o PV do PVC $PVC (ele está Bound?)" >&2
  exit 1
fi

if [ ! -d "$ORIGEM" ]; then
  echo "erro: volume Docker $ORIGEM não existe" >&2
  exit 1
fi

echo "[1/4] parando container $SVC"
docker stop "$SVC" >/dev/null || { echo "erro ao parar $SVC" >&2; exit 1; }

echo "[2/4] copiando $ORIGEM -> $DESTINO"
# `/.` no fim da origem copia o CONTEÚDO, não o diretório. Sem isso ficaria
# $DESTINO/_data/... e o Prometheus não acharia o WAL.
cp -a "${ORIGEM}/." "$DESTINO/" || {
  echo "erro na cópia; religando $SVC" >&2
  docker start "$SVC" >/dev/null
  exit 1
}

echo "[3/4] religando container $SVC (rollback continua de pé)"
docker start "$SVC" >/dev/null

echo "[4/4] resultado"
du -sh "$DESTINO" 2>/dev/null
echo "origem: $(du -sh "$ORIGEM" 2>/dev/null | cut -f1)"
