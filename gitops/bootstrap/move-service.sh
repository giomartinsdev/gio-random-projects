#!/bin/bash
# move-service.sh — move UM serviço de giomartins para o namespace fatiado.
#
# ## Uso
#   sudo move-service.sh <namespace-destino> <nome-do-app> <arquivo-render>
#
# O `<arquivo-render>` é a saída de `kubectl kustomize gitops/apps/<ns>/<app>`,
# gerada NA MÁQUINA DE DESENVOLVIMENTO e enviada pronta. Não se aplica manifesto
# cru: `deployment.yaml` não tem `namespace:` (ele vive no kustomization), e
# `kubectl apply -f deployment.yaml` cria o pod em `default` — foi exatamente o
# que aconteceu com o evolution-redis em 2026-10-23.
#
# ## As cinco fases
#
#   1. se há PVC: parar pod, ESPERAR sumir, rebind Bound->Released->Available->Bound,
#      com asserção de identidade (`volumeName` do PVC novo == PV original)
#   2. aplicar o render SEM os Services -- o pod sobe enquanto o NodePort antigo
#      ainda está em uso, então não há conflito de porta
#   3. esperar Ready
#   4. trocar o Service: apagar o de giomartins (libera NodePort), aplicar o novo
#      (mesma porta), e deixar um ExternalName em giomartins para quem ainda não
#      migrou continuar resolvendo o nome curto
#   5. apagar o Deployment antigo
#
# ## Idempotência
#
# Rodar de novo num serviço já movido: a fase 1 não encontra PVC em giomartins e
# avisa; a fase 2 aplica sobre o que existe; a fase 4 recria o alias.
set -uo pipefail || exit 1

K="k3s kubectl"
DESTINO="${1:-}"
APP="${2:-}"
RENDER="${3:-}"
ORIGEM=giomartins

[ -n "$DESTINO" ] && [ -n "$APP" ] && [ -f "$RENDER" ] || {
  echo "uso: $0 <namespace-destino> <app> <arquivo-render>"; exit 2; }

log()  { echo "  [$APP] $*"; }
erro() { echo "  [$APP] ERRO: $*" >&2; }

# ---------------------------------------------------------------------------
# Inventário do render
# ---------------------------------------------------------------------------
# Divide o arquivo multi-documento em "com Service" e "sem Service".
#
# A lógica vive em `divide.py`, não aqui: as duas tentativas anteriores em awk
# quebraram arquivos reais em produção (o `$` ancora no fim da STRING num buffer
# multi-linha, e o separador `---` recolocado antes de `kind:` caía depois do
# `apiVersion:`). Uma implementação, testada, usada por todos.
DIVIDE="$(dirname "$0")/divide.py"
if [ -f "$DIVIDE" ]; then
  python3 "$DIVIDE" "$RENDER" "/tmp/${APP}.sem-svc.yaml" "/tmp/${APP}.so-svc.yaml" | sed 's/^/    /'
else
  erro "divide.py não encontrado ao lado deste script"; exit 1
fi

# `kind: Service$` com âncora: sem o `$`, `kind: ServiceAccount` também casa e o
# script tentaria criar um "Service" chamado alloy-logs.
TEM_SVC=$(grep -c "^kind: Service$" "$RENDER" 2>/dev/null || echo 0)
log "render: $TEM_SVC Service(s)"

# ---------------------------------------------------------------------------
# Fase 1 — PVCs (pode haver mais de um: o stack de observability tem quatro)
# ---------------------------------------------------------------------------
# Todos os PVCs do render, não só o primeiro. O `observability` move prometheus,
# loki, tempo e grafana no mesmo arquivo; tratar um só deixaria três PVs órfãos.
#
# ## A falha que isto corrige (2026-10-23, Postgres)
#
# A primeira versão usava `awk` com `/^  name: /` sobre um buffer MULTI-LINHA. O
# `^` do awk ancora no início da STRING, não da linha — então NENHUM PVC era
# detectado. O script dizia "sem PVC — nada a rebindar", o `apply` criava um PVC
# novo, o provisioner dava um PV NOVO E VAZIO, e o Postgres subiu com 0 tabelas
# enquanto o dado real (1176 linhas) ficava num PV órfão.
#
# Agora a extração é por linha, e há uma trava: se o render declara PVC e o PV
# não é encontrado, o script ABORTA em vez de aplicar.
PVC_TODOS=$(python3 - "$RENDER" <<'PY'
import sys

docs, atual = [], []
for linha in open(sys.argv[1]).read().splitlines():
    if linha.strip() == "---":
        if atual:
            docs.append(atual)
        atual = []
    else:
        atual.append(linha)
if atual:
    docs.append(atual)

for d in docs:
    if any(l.strip() == "kind: PersistentVolumeClaim" for l in d):
        for l in d:
            if l.startswith("  name:"):
                print(l.split(":", 1)[1].strip())
                break
PY
)

if [ -n "$PVC_TODOS" ]; then
  for p in $PVC_TODOS; do
    if ! $K get pvc "$p" -n "$ORIGEM" >/dev/null 2>&1 && \
       ! $K get pvc "$p" -n "$DESTINO" >/dev/null 2>&1; then
      erro "o render declara o PVC '$p', mas ele não existe nem em $ORIGEM nem em $DESTINO"
      erro "recusando aplicar: PVC ausente vira volume NOVO E VAZIO (foi assim que o Postgres subiu vazio)"
      exit 1
    fi
  done
fi

for PVC_ANTIGO in $PVC_TODOS; do
  PV=$($K get pvc "$PVC_ANTIGO" -n "$ORIGEM" -o jsonpath='{.spec.volumeName}' 2>/dev/null)

  if [ -z "$PV" ]; then
    log "PVC $PVC_ANTIGO não existe em $ORIGEM (já migrado?) — pulando rebind"
  else
    log "=== fase 1: rebind de $PVC_ANTIGO (PV $PV) ==="

    POLICY=$($K get pv "$PV" -o jsonpath='{.spec.persistentVolumeReclaimPolicy}')
    if [ "$POLICY" != "Retain" ]; then
      log "reclaimPolicy=$POLICY — mudando para Retain ANTES de tocar no PVC"
      $K patch pv "$PV" -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}' >/dev/null || {
        erro "não consegui mudar reclaimPolicy"; exit 1; }
    fi

    DIR=$($K get pv "$PV" -o jsonpath='{.spec.local.path}')
    [ -d "$DIR" ] || { erro "diretório $DIR não existe — abortando"; exit 1; }
    # A testemunha é BYTES, não contagem de arquivos. O Loki apaga chunks
    # obsoletos ao fechar (compactor), então 5092 -> 5090 arquivos é normal e
    # abortou a janela por engano. Bytes pegam o modo de falha que importa --
    # volume novo e vazio -- sem falso positivo em armazenamento que compacta.
    ANTES_BYTES=$(du -sb "$DIR" 2>/dev/null | awk '{print $1}')
    ANTES=$(find "$DIR" -type f 2>/dev/null | wc -l)
    log "volume: $DIR ($ANTES arquivos, ${ANTES_BYTES} bytes)"

    # Nomes de Deployment que montam este PVC em giomartins: podem ser mais de um.
    DONOS=$($K get deploy -n "$ORIGEM" -o json 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
for x in d['items']:
    for v in (x['spec']['template']['spec'].get('volumes') or []):
        if (v.get('persistentVolumeClaim') or {}).get('claimName') == '$PVC_ANTIGO':
            print(x['metadata']['name'])
")
    for d in $DONOS; do
      log "escalando deploy/$d para 0"
      $K scale deploy "$d" -n "$ORIGEM" --replicas=0 >/dev/null 2>&1
    done

    # Espera TODO pod que monta o PVC sumir. Sem isso o finalizer
    # kubernetes.io/pvc-protection prende o PVC em Terminating para sempre.
    for i in $(seq 1 60); do
      n=0
      for d in $DONOS; do
        c=$($K get pods -n "$ORIGEM" -l "app.kubernetes.io/name=$d" --no-headers 2>/dev/null | wc -l | tr -d ' ')
        n=$((n + c))
      done
      [ "$n" -eq 0 ] && break
      sleep 2
    done
    [ "${n:-0}" -eq 0 ] || { erro "pod não sumiu — abortando SEM tocar no PVC"; exit 1; }
    log "pods removidos"

    $K delete pvc "$PVC_ANTIGO" -n "$ORIGEM" --timeout=60s >/dev/null 2>&1 || true
    for i in $(seq 1 30); do
      ph=$($K get pv "$PV" -o jsonpath='{.status.phase}'); [ "$ph" = "Released" ] && break; sleep 1
    done
    [ "$ph" = "Released" ] || { erro "PV em '$ph', esperado Released — dado intacto em $DIR"; exit 1; }
    log "PV Released"

    $K patch pv "$PV" --type=json -p='[{"op":"remove","path":"/spec/claimRef"}]' >/dev/null 2>&1 \
      || $K patch pv "$PV" --type=merge -p '{"spec":{"claimRef":null}}' >/dev/null 2>&1
    for i in $(seq 1 30); do
      ph=$($K get pv "$PV" -o jsonpath='{.status.phase}'); [ "$ph" = "Available" ] && break; sleep 1
    done
    [ "$ph" = "Available" ] || { erro "PV em '$ph', esperado Available"; exit 1; }
    log "PV Available"

    CAP=$($K get pv "$PV" -o jsonpath='{.spec.capacity.storage}')
    $K patch pv "$PV" --type=merge \
      -p "{\"spec\":{\"claimRef\":{\"namespace\":\"$DESTINO\",\"name\":\"$PVC_ANTIGO\"}}}" >/dev/null

    $K apply -f - >/dev/null <<YAML
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: $PVC_ANTIGO
  namespace: $DESTINO
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: local-path
  resources:
    requests:
      storage: $CAP
YAML
    for i in $(seq 1 30); do
      ph=$($K get pvc "$PVC_ANTIGO" -n "$DESTINO" -o jsonpath='{.status.phase}' 2>/dev/null)
      [ "$ph" = "Bound" ] && break; sleep 1
    done
    NOVO=$($K get pvc "$PVC_ANTIGO" -n "$DESTINO" -o jsonpath='{.spec.volumeName}' 2>/dev/null)

    # A asserção que separa "migrou" de "perdeu o dado": um volume novo e vazio
    # também deixa o pod subir e o ArgoCD verde.
    if [ "$NOVO" != "$PV" ]; then
      erro "ligou em '$NOVO', esperado '$PV' — VOLUME NOVO E VAZIO"
      erro "o dado original continua em $DIR (PV $PV disponível)"
      exit 1
    fi
    # ## Por que a testemunha é BYTES, não contagem de arquivos
    #
    # A primeira versão comparava `find | wc -l` e abortou no Loki: 5092 -> 5090
    # arquivos. Não era perda -- o compactor do Loki apaga chunks obsoletos ao
    # fechar, e o próprio log do pod mostra `compactor` trabalhando. Contagem de
    # arquivos é um witness ruim para armazenamento que compacta; bytes não são.
    #
    # A tolerância existe só para compactação real. Um volume que ficou vazio
    # quando antes tinha dado é o modo de falha que importa.
    #
    # ## Mas "vazio" só é suspeito se ANTES não era vazio
    #
    # Em 2026-10-23 o `evolution-instances` abortou a janela por "volume vazio":
    # ele sempre foi vazio (0 bytes, um diretório criado em 4/out sem conteúdo --
    # o estado real do WhatsApp mora no Postgres e no Redis). A guarda olhava o
    # valor absoluto em vez da VARIAÇÃO, e virou falso positivo justamente no
    # serviço mais delicado.
    DEPOIS=$(du -sb "$DIR" 2>/dev/null | awk '{print $1}')
    if [ -z "$DEPOIS" ]; then
      erro "não consegui medir $DIR -- abortando sem concluir"
      exit 1
    fi
    if [ "${ANTES_BYTES:-0}" -eq 0 ] && [ "$DEPOIS" -eq 0 ]; then
      log "ASSERÇÃO OK: mesmo PV, volume sempre vazio (0 bytes antes e depois)"
    elif [ "$DEPOIS" -eq 0 ]; then
      erro "volume tinha ${ANTES_BYTES} bytes e ficou vazio -- PERDA DE DADO"
      exit 1
    elif [ "${ANTES_BYTES:-0}" -gt 0 ]; then
      PCT=$((DEPOIS * 100 / ANTES_BYTES))
      log "ASSERÇÃO OK: mesmo PV, ${DEPOIS} bytes (${PCT}% de ${ANTES_BYTES})"
      if [ "$PCT" -lt 80 ]; then
        erro "o volume encolheu para ${PCT}% -- investigar antes de seguir"
        exit 1
      fi
    else
      log "ASSERÇÃO OK: mesmo PV, ${DEPOIS} bytes"
    fi
  fi
done

if [ -z "$PVC_TODOS" ]; then
  log "sem PVC — nada a rebindar"
fi

# Deployments deste render: usado pela fase 2 (WORKER) e pela fase 3 (Ready).
DEPLOYS_DESTE_APP=$(python3 - "$RENDER" <<'PY2'
import sys
docs, atual = [], []
for linha in open(sys.argv[1]).read().splitlines():
    if linha.strip() == "---":
        if atual: docs.append(atual)
        atual = []
    else:
        atual.append(linha)
if atual: docs.append(atual)
for d in docs:
    if any(l.strip() == "kind: Deployment" for l in d):
        for l in d:
            if l.startswith("  name:"):
                print(l.split(":", 1)[1].strip())
                break
PY2
)

# ---------------------------------------------------------------------------
# Fase 2 — aplicar SEM os Services
# ---------------------------------------------------------------------------
# ## `WORKER=1` — parar o antigo ANTES de subir o novo
#
# Para um consumidor de fila, "aplicar o novo e depois remover o antigo" significa
# dois consumers na mesma fila por alguns segundos, e a mesma mensagem processada
# duas vezes. Não é um erro visível: é escrita duplicada no Postgres. O
# `domain/worker.yaml` já documenta isso desde a fatia 1.
#
# Com `WORKER=1`, o Deployment antigo vai a 0 e espera os pods sumirem antes do
# apply. O rollback continua barato (o manifesto está no giomartins? não — mas o
# `scale --replicas=1` no antigo é imediato enquanto ele existir).
if [ "${WORKER:-0}" = "1" ]; then
  log "=== fase 2 (modo WORKER): parando o consumidor antigo primeiro ==="
  # Só os Deployments DESTE app que são consumidores de fila. Filtrar
  # `*worker*` no namespace inteiro parava os workers de `finance` enquanto o
  # `domain` migrava -- efeito colateral desnecessário.
  PARAR=""
  for d in $DEPLOYS_DESTE_APP; do
    if $K get deploy "$d" -n "$ORIGEM" >/dev/null 2>&1; then
      case "$d" in
        *worker*) PARAR="$PARAR $d" ;;
      esac
    fi
  done
  if [ -z "$PARAR" ]; then
    log "  nenhum worker deste app em $ORIGEM -- nada a parar"
  else
    for d in $PARAR; do
      log "  parando deploy/$d"
      $K scale deploy "$d" -n "$ORIGEM" --replicas=0 >/dev/null 2>&1
    done
    for i in $(seq 1 60); do
      n=0
      for d in $PARAR; do
        c=$($K get pods -n "$ORIGEM" -l "app.kubernetes.io/name=$d" --no-headers 2>/dev/null | wc -l | tr -d ' ')
        n=$((n + c))
      done
      [ "$n" -eq 0 ] && break
      sleep 2
    done
    log "  consumers antigos parados (pods restantes: ${n:-0})"
  fi
fi

log "=== fase 2: aplicar workload em $DESTINO ==="
$K apply -f "/tmp/${APP}.sem-svc.yaml" 2>&1 | sed 's/^/    /'

# ---------------------------------------------------------------------------
# Inventário de Services: nomes e o documento de cada um
# ---------------------------------------------------------------------------
# Extraído UMA vez, aqui, e usado tanto pela fase 2.5 (provisório) quanto pela
# fase 4 (definitivo). Duas extrações separadas divergiriam na primeira
# manutenção -- a fase 4 tinha a sua própria cópia do parser.
SVCS=$(python3 - "$RENDER" <<'PY'
import sys
docs, atual = [], []
for linha in open(sys.argv[1]).read().splitlines():
    if linha.strip() == "---":
        if atual: docs.append(atual)
        atual = []
    else:
        atual.append(linha)
if atual: docs.append(atual)
for d in docs:
    if any(l.strip() == "kind: Service" for l in d):
        for l in d:
            if l.startswith("  name:"):
                print(l.split(":", 1)[1].strip())
                break
PY
)

for s in $SVCS; do
  python3 - "$RENDER" "$s" "/tmp/${APP}.${s}.render.yaml" <<'PY'
import sys
render, alvo, saida = sys.argv[1], sys.argv[2], sys.argv[3]
docs, atual = [], []
for linha in open(render).read().splitlines():
    if linha.strip() == "---":
        if atual: docs.append(atual)
        atual = []
    else:
        atual.append(linha)
if atual: docs.append(atual)
for d in docs:
    if any(l.strip() == "kind: Service" for l in d):
        nomes = [l.split(":", 1)[1].strip() for l in d if l.startswith("  name:")]
        if nomes and nomes[0] == alvo:
            open(saida, "w").write("\n".join(d).rstrip("\n") + "\n")
            break
PY
done

# ---------------------------------------------------------------------------
# Fase 2.5 — publicar os Services no destino ANTES de exigir Ready
# ---------------------------------------------------------------------------
# ## A falha que isto corrige (2026-10-23, db-mcp-gateway)
#
# A ordem antiga era: aplicar workload -> esperar Ready -> trocar Services.
# Mas `db-mcp-gateway` (nginx) resolve o upstream `db-mcp` NO START e morre com
# `host not found in upstream` se o Service não existir. Dependência
# intra-namespace exige o Service antes do pod, e o script dava deadlock:
# esperava Ready de um pod que só ficaria Ready depois da fase 4.
#
# Aqui o Service sobe a partir do PRÓPRIO render, com `nodePort` removido e
# `type: ClusterIP` forçado: a porta 30xxx continua reservada para o Service
# antigo até a fase 4. Assim não há disputa de NodePort e o nome resolve.
for s in $SVCS; do
  python3 - "/tmp/${APP}.${s}.render.yaml" "/tmp/${APP}.${s}.provisorio.yaml" <<'PY'
import sys

origem, destino = sys.argv[1], sys.argv[2]
linhas = open(origem).read().splitlines()
saida = []
for linha in linhas:
    t = linha.strip()
    if t.startswith("nodePort:"):
        continue
    if t == "type: NodePort":
        saida.append("  type: ClusterIP")
        continue
    saida.append(linha)
open(destino, "w").write("\n".join(saida).rstrip("\n") + "\n")
PY

  if $K apply -f "/tmp/${APP}.${s}.provisorio.yaml" >/dev/null 2>&1; then
    log "  svc/$s provisório (ClusterIP) em $DESTINO"
  else
    erro "  não consegui publicar o svc/$s provisório"
    $K apply -f "/tmp/${APP}.${s}.provisorio.yaml" 2>&1 | sed 's/^/    /'
  fi
done

# ---------------------------------------------------------------------------
# Fase 3 — esperar Ready
# ---------------------------------------------------------------------------
DEPLOYS=$(python3 - "$RENDER" <<'PY'
import sys
docs, atual = [], []
for linha in open(sys.argv[1]).read().splitlines():
    if linha.strip() == "---":
        if atual: docs.append(atual)
        atual = []
    else:
        atual.append(linha)
if atual: docs.append(atual)
for d in docs:
    if any(l.strip() == "kind: Deployment" for l in d):
        for l in d:
            if l.startswith("  name:"):
                print(l.split(":", 1)[1].strip())
                break
PY
)
OK=1
for d in $DEPLOYS; do
  ready=""
  for i in $(seq 1 90); do
    ready=$($K get deploy "$d" -n "$DESTINO" -o jsonpath='{.status.readyReplicas}' 2>/dev/null)
    [ "$ready" = "1" ] && break
    # Deployment com replicas 0 é "pronto" por definição.
    rep=$($K get deploy "$d" -n "$DESTINO" -o jsonpath='{.spec.replicas}' 2>/dev/null)
    [ "$rep" = "0" ] && { ready=0; break; }
    sleep 2
  done
  log "deploy/$d ready=${ready:-nenhum}"
  [ -n "$ready" ] || OK=0
done
[ "$OK" = "1" ] || {
  erro "workload não ficou pronto — NÃO mexo no Service antigo"
  $K get pods -n "$DESTINO" 2>/dev/null | sed 's/^/    /'
  exit 1; }

# ---------------------------------------------------------------------------
# Fase 4 — trocar o Service (libera NodePort) e deixar alias de transição
# ---------------------------------------------------------------------------
if [ "$TEM_SVC" -gt 0 ]; then
  log "=== fase 4: trocar Service(s) ==="
  for s in $SVCS; do
    # O documento de cada Service já foi extraído para
    # /tmp/<app>.<svc>.render.yaml antes da fase 2.5 -- mesma fonte de verdade
    # usada para o provisório, para não haver duas extrações divergindo.
    if ! grep -q "^kind: Service" "/tmp/${APP}.${s}.render.yaml" 2>/dev/null; then
      erro "não consegui extrair o Service/$s do render — pulando"
      continue
    fi

    OLD_TYPE=$($K get svc "$s" -n "$ORIGEM" -o jsonpath='{.spec.type}' 2>/dev/null)
    OLD_EXT=$($K get svc "$s" -n "$ORIGEM" -o jsonpath='{.spec.externalName}' 2>/dev/null)
    OLD_PORTS=$($K get svc "$s" -n "$ORIGEM" -o jsonpath='{range .spec.ports[*]}{.name}{"|"}{.port}{"|"}{.protocol}{"\n"}{end}' 2>/dev/null)
    TIPO_NOVO=$(grep "type:" "/tmp/${APP}.${s}.render.yaml" | awk '{print $2}' | head -1)

    # Alias de transição só para Service real. Um ExternalName não tem NodePort
    # nem endpoints, e recriá-lo como alias-de-alias não faz sentido.
    if [ "$OLD_TYPE" = "ExternalName" ] && [ "$OLD_EXT" = "$s.$DESTINO.svc.cluster.local" ]; then
      log "svc/$s em $ORIGEM já é o alias correto"
      continue
    fi

    # O NodePort é cluster-wide: dois Services não podem deter a mesma porta.
    # Por isso o antigo sai ANTES do novo entrar -- a janela de indisponibilidade
    # deste nome é a de recriar um Service (~1s), não a de subir um pod.
    $K delete svc "$s" -n "$ORIGEM" --ignore-not-found >/dev/null 2>&1

    if ! $K apply -f "/tmp/${APP}.${s}.render.yaml" >/dev/null 2>&1; then
      erro "apply do Service/$s falhou em $DESTINO"
      $K apply -f "/tmp/${APP}.${s}.render.yaml" 2>&1 | sed 's/^/    /'
      FALHA_SVC=1
      continue
    fi
    log "svc/$s: $ORIGEM -> $DESTINO"

    # Alias para quem ficou em giomartins. Só faz sentido para Service real
    # (ClusterIP/NodePort), que é o caso aqui.
    if [ -n "$OLD_PORTS" ] && [ "$TIPO_NOVO" != "ExternalName" ]; then
      {
        echo "apiVersion: v1"
        echo "kind: Service"
        echo "metadata:"
        echo "  name: $s"
        echo "  namespace: $ORIGEM"
        echo "  labels:"
        echo "    app.kubernetes.io/part-of: giomartins"
        echo "    giomartins.dev/role: alias-transitorio"
        echo "  annotations:"
        echo "    giomartins.dev/alias-of: $s.$DESTINO.svc.cluster.local"
        echo "    giomartins.dev/motivo: consumidores que ainda nao migraram"
        echo "spec:"
        echo "  type: ExternalName"
        echo "  externalName: $s.$DESTINO.svc.cluster.local"
        echo "  ports:"
        echo "$OLD_PORTS" | while IFS='|' read -r nome porta proto; do
          [ -z "$porta" ] && continue
          echo "    - port: $porta"
          [ -n "$nome" ] && echo "      name: $nome"
          [ -n "$proto" ] && echo "      protocol: $proto"
        done
      } > "/tmp/${s}.alias.yaml"
      $K apply -f "/tmp/${s}.alias.yaml" >/dev/null 2>&1 \
        && log "  alias em $ORIGEM: $s -> $DESTINO" \
        || erro "  não consegui criar o alias de $s em $ORIGEM"
    fi
  done
fi

# ---------------------------------------------------------------------------
# Fase 5 — remover o Deployment antigo
# ---------------------------------------------------------------------------
# ## Por que a fase 5 depende da fase 4
#
# Em 2026-10-23 o `db-mcp` provou o pior caso: a fase 4 falhou (caminho de
# arquivo errado), mas a fase 5 rodou assim mesmo e apagou os Deployments de
# `giomartins`. Resultado: os pods novos estavam de pé, mas o Service de
# produção tinha acabado de ser removido sem substituto -- o `db-mcp-gateway`
# ficou sem rota. O workload antigo é o rollback; ele só pode cair quando o
# Service novo já está no ar.
if [ "${FALHA_SVC:-0}" = "1" ]; then
  erro "fase 4 falhou — mantendo TODOS os Deployments de $ORIGEM como rollback"
  $K get deploy -n "$DESTINO" 2>/dev/null | sed 's/^/    /'
  exit 1
fi

log "=== fase 5: remover Deployment antigo de $ORIGEM ==="
for d in $DEPLOYS; do
  # Só apaga se existir em giomartins E existir em DESTINO.
  if $K get deploy "$d" -n "$ORIGEM" >/dev/null 2>&1; then
    if $K get deploy "$d" -n "$DESTINO" >/dev/null 2>&1; then
      $K delete deploy "$d" -n "$ORIGEM" --ignore-not-found 2>&1 | sed 's/^/    /'
    else
      erro "deploy/$d NÃO existe em $DESTINO — mantendo o de $ORIGEM"
    fi
  fi
done

log "concluído"
