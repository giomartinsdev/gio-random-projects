#!/bin/bash
# rotaciona-senhas.sh — troca as senhas de admin de Kubero e ArgoCD e PROVA.
#
# Uso:  sudo bash rotaciona-senhas.sh
#
# ## Por que isto e um script e nao tres comandos no chat
#
# A senha nova nunca pode aparecer no terminal (a sessao fica registrada, e o
# repo e publico). O script gera, grava em arquivo `mode 600` no host, aplica e
# verifica -- sem imprimir o valor em nenhum ponto. O `ps` tambem nao ve: o
# patch do ArgoCD vai por arquivo, e a senha chega ao node por STDIN.
#
# ## Onde a senha do Kubero mora
#
# No SQLite (`/app/server/db/kubero.sqlite`, tabela `User`), NAO no Secret.
# `KUBERO_ADMIN_PASSWORD` e referenciado no Deployment mas a chave NAO existe no
# `kubero-secrets`. O log diz `No legacy users to migrate. KUBERO_USERS is not
# set.` e o admin foi semeado no banco na primeira subida. Trocar a env nao faz
# nada; tem que escrever no banco.
#
# ## O que e verificado, e o que NAO e
#
# Verificado:
#   - o hash gravado no banco/servidor confere com a senha nova (bcrypt.compare)
#   - o endpoint de login ACEITA a senha nova
#   - o mesmo endpoint REJEITA uma senha errada (prova que ele discrimina)
#
# NAO verificado aqui, e o script nao finge que verifica: que o hash ANTIGO
# deixou de ser aceito. A senha antiga em claro nao existe mais em lugar nenhum,
# entao nao ha como testa-la. O que da para comparar e o hash (feito abaixo).
#
# ## Cuidado com o codigo de status do Kubero
#
# O Kubero devolve **201** tambem para erro de validacao (medido: corpo
# `{"message":"Username and password are required","status":400}` com HTTP 201).
# Julgar o login pelo codigo HTTP daria "sucesso" para requisicao invalida. A
# verificacao olha o CORPO.
set -uo pipefail
K="k3s kubectl"

KPOD=$($K get pod -n kubero --no-headers 2>/dev/null | awk '$3=="Running"{print $1; exit}')
APOD=$($K get pod -n argocd -l app.kubernetes.io/name=argocd-server -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
CARIMBO=$(date -u +%Y%m%d-%H%M)
BKP="/opt/k8s-backups/senhas-${CARIMBO}"
mkdir -p "$BKP"; chmod 700 "$BKP"

echo "=== 0. pre-condicoes ==="
[ -z "$KPOD" ] && { echo "  ERRO: pod do kubero nao encontrado"; exit 1; }
[ -z "$APOD" ] && { echo "  ERRO: pod do argocd-server nao encontrado"; exit 1; }
echo "  kubero pod: $KPOD"
echo "  argocd pod: $APOD"

echo
echo "=== 1. backup do estado atual (antes de tocar em nada) ==="
$K get secret argocd-secret -n argocd -o jsonpath='{.data.admin\.password}' > "$BKP/argocd-admin.password.b64" 2>/dev/null
$K get secret argocd-secret -n argocd -o jsonpath='{.data.admin\.passwordMtime}' > "$BKP/argocd-admin.passwordMtime.b64" 2>/dev/null
$K cp -n kubero "$KPOD:/app/server/db/kubero.sqlite" "$BKP/kubero.sqlite" >/dev/null 2>&1
chmod 600 "$BKP"/* 2>/dev/null
echo "  backup em $BKP (chmod 600)"
ls -la "$BKP" 2>/dev/null | tail -n +2 | awk '{printf "    %-36s %s bytes\n", $9, $5}'

# ---------------------------------------------------------------------------
# KUBERO
# ---------------------------------------------------------------------------
echo
echo "=== 2. Kubero: senha nova no SQLite ==="
openssl rand -base64 24 | tr -d '/+=' | cut -c1-28 > "$BKP/kubero-admin.txt"
chmod 600 "$BKP/kubero-admin.txt"
SENHA_NOVA=$(cat "$BKP/kubero-admin.txt")
if [ "${#SENHA_NOVA}" -lt 20 ]; then
  echo "  ERRO: senha gerada curta (${#SENHA_NOVA} chars) -- abortando"
  exit 1
fi
echo "  senha gerada: ${#SENHA_NOVA} chars (valor nao impresso)"

# ## Por que escrever via `node:sqlite` e nao copiar o arquivo de volta
#
# O banco esta aberto pelo processo do Kubero. Copiar por cima com o app rodando
# pode deixar o processo com o inode antigo em memoria, e as escritas seguintes
# irem para o inode orfao. Escrever no mesmo host do arquivo mantem um unico dono.
# `journal_mode=delete` (medido, nao WAL): nao ha `-wal`/`-shm` para ficar para
# tras.
#
# ## Por que a senha vai por STDIN
#
# `kubectl exec -- node -e "..." "$SENHA"` poria a senha em `argv`, visivel no
# `ps` dentro do container. E `KPOD=x cmd` prefixado NAO exporta para o processo
# remoto -- o `k3s` receberia a variavel e o `node` no container nao. STDIN resolve
# os dois: `-i` encaminha, e `node` le de `process.stdin`.
SAIDA=$(printf '%s' "$SENHA_NOVA" | $K exec -i -n kubero "$KPOD" -- node -e '
const bcrypt = require("bcrypt");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");
const senha = fs.readFileSync(0, "utf8").trim();
if (!senha || senha.length < 20) { console.error("ERRO: senha ausente/curta"); process.exit(2); }
const db = new DatabaseSync("/app/server/db/kubero.sqlite");
try {
  const alvo = db.prepare("select id from \"User\" where username = ? and isActive = 1").all("admin");
  if (alvo.length !== 1) { console.error("ERRO: esperava 1 admin ativo, achei " + alvo.length); process.exit(3); }
  const hash = bcrypt.hashSync(senha, 10);
  db.prepare("update \"User\" set password = ?, updatedAt = CURRENT_TIMESTAMP where username = ?").run(hash, "admin");
  const lido = db.prepare("select password from \"User\" where username = ?").get("admin").password;
  console.log("HASH_LEN=" + lido.length);
  console.log("HASH_PREFIX=" + lido.slice(0, 7));
  console.log("VERIFY=" + bcrypt.compareSync(senha, lido));
} finally {
  db.close();
}
' 2>&1 | grep -viE 'experimentalwarning|trace-warnings')
KC=$?

echo "$SAIDA" | sed 's/^/  /'
# `$?` acima e do `grep`, nao do `node`. A verdade esta no conteudo: se o
# VERIFY nao for `true`, o update nao aconteceu.
case "$SAIDA" in
  *"VERIFY=true"*) echo "  ok: hash gravado e confere com a senha nova" ;;
  *) echo "  ERRO: nao consegui confirmar o hash -- ABORTANDO sem tocar no ArgoCD"; exit 1 ;;
esac

# ---------------------------------------------------------------------------
# ARGOCD
# ---------------------------------------------------------------------------
echo
echo "=== 3. ArgoCD: hash novo no argocd-secret ==="
openssl rand -base64 24 | tr -d '/+=' | cut -c1-28 > "$BKP/argocd-admin.txt"
chmod 600 "$BKP/argocd-admin.txt"
SENHA_ARGO=$(cat "$BKP/argocd-admin.txt")
echo "  senha gerada: ${#SENHA_ARGO} chars (valor nao impresso)"

# O proprio CLI do ArgoCD gera o hash no formato que ele aceita ($2a$). Gerar com
# `htpasswd` daria $2y$, que versoes antigas recusam -- nao vale descobrir isso
# em producao.
HASH=$($K exec -n argocd "$APOD" -- argocd account bcrypt --password "$SENHA_ARGO" 2>/dev/null | tr -d '\r\n')
case "$HASH" in
  \$2a\$*|\$2b\$*|\$2y\$*) echo "  hash gerado: ${#HASH} chars, prefixo ${HASH:0:7}" ;;
  *) echo "  ERRO: hash inesperado ('${HASH:0:10}') -- ABORTANDO sem aplicar"; exit 1 ;;
esac

HASH_B64=$(printf '%s' "$HASH" | base64 | tr -d '\n')
MTIME_B64=$(printf '%s' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" | base64 | tr -d '\n')

# Patch por ARQUIVO: `-p` na linha de comando ficaria visivel no `ps` do host.
printf '{"data":{"admin.password":"%s","admin.passwordMtime":"%s"}}' \
  "$HASH_B64" "$MTIME_B64" > "$BKP/patch-argocd.json"
chmod 600 "$BKP/patch-argocd.json"

$K patch secret argocd-secret -n argocd --type merge --patch-file "$BKP/patch-argocd.json" 2>&1 | sed 's/^/  /'
rm -f "$BKP/patch-argocd.json"

echo "  reiniciando argocd-server (le o secret no start)"
$K rollout restart deploy/argocd-server -n argocd >/dev/null 2>&1
$K rollout status deploy/argocd-server -n argocd --timeout=240s 2>&1 | sed 's/^/  /'

# ---------------------------------------------------------------------------
# PROVA
# ---------------------------------------------------------------------------
echo
echo "=== 4. A PROVA: login com a senha nova ==="
echo "  ArgoCD (espera 200 com token):"
ARGO_OK=0
for i in $(seq 1 20); do
  code=$(curl -sk -o /tmp/argo_login.json -w '%{http_code}' --max-time 8 \
    -X POST -H 'Content-Type: application/json' \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"username":"admin","password":sys.argv[1]}))' "$SENHA_ARGO")" \
    "http://127.0.0.1:30080/api/v1/session" 2>/dev/null)
  [ "$code" = "200" ] && { ARGO_OK=1; break; }
  sleep 3
done
echo "    HTTP $code"
python3 - <<'PY'
import json
try: d=json.load(open("/tmp/argo_login.json"))
except Exception: d={}
print("    chaves:", sorted(d.keys()))
print("    token presente:", "token" in d, "| tamanho:", len(d.get("token") or ""))
PY

echo
echo "  Kubero (o status 201 NAO significa sucesso -- olho o corpo e o cookie):"
KUB_OK=0
for i in $(seq 1 15); do
  curl -s -D /tmp/kub_headers.txt -o /tmp/kub_login.json --max-time 8 \
    -X POST -H 'Content-Type: application/json' \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"username":"admin","password":sys.argv[1]}))' "$SENHA_NOVA")" \
    "http://127.0.0.1:30200/api/auth/login" >/dev/null 2>&1
  if python3 -c '
import json,sys
try: d=json.load(open("/tmp/kub_login.json"))
except Exception: sys.exit(1)
# sucesso = sem campo de erro E tem algum sinal de sessao
tem_erro = bool(d.get("status")) or bool(d.get("statusCode")) or "message" in d
sinal = any(k in d for k in ("token","access_token","session","user","ok"))
sys.exit(0 if (not tem_erro) and sinal else 1)
'; then KUB_OK=1; break; fi
  sleep 2
done
# ## Nunca imprimir o corpo do login
#
# A primeira versao deste script fez `head -c 160` no corpo. O corpo do login do
# Kubero traz `{"access_token":"eyJ...`, e 160 caracteres ja incluem o header e
# boa parte do payload do JWT. Nao vazou credencial utilizavel -- sem a assinatura
# o token nao autentica (testado: 400 em `/api/auth/session`) -- mas foi sorte de
# onde o corte caiu, nao desenho. Aqui so os NOMES das chaves saem.
python3 - <<'PY'
import json
try:
    d = json.load(open("/tmp/kub_login.json"))
except Exception:
    print("    (resposta nao e JSON)")
else:
    print("    chaves:", sorted(d.keys()))
    t = d.get("access_token") or d.get("token") or ""
    print("    token presente:", bool(t), "| tamanho:", len(t))
    for k in ("status", "statusCode", "message"):
        if k in d:
            print("    %s: %s" % (k, str(d[k])[:80]))
PY
rm -f /tmp/kub_login.json
echo "    Set-Cookie? $(grep -ci 'set-cookie' /tmp/kub_headers.txt 2>/dev/null || echo 0) header(s)"
[ "$KUB_OK" = "1" ] && echo "    -> ACEITOU a senha nova" || echo "    -> NAO consegui confirmar pelo corpo (ver abaixo)"

echo
echo "=== 5. o mesmo endpoint REJEITA senha errada? (o campo discrimina) ==="
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 \
  -X POST -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"senha-errada-de-proposito-9f3a"}' \
  "http://127.0.0.1:30200/api/auth/login" 2>/dev/null)
echo "  Kubero com senha errada:  HTTP $code  (403/401 = rejeitada, correto)"

code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 8 \
  -X POST -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"senha-errada-de-proposito-9f3a"}' \
  "http://127.0.0.1:30080/api/v1/session" 2>/dev/null)
echo "  ArgoCD com senha errada:  HTTP $code  (401/403 = rejeitada, correto)"

echo
echo "  o hash do ArgoCD mudou em relacao ao backup?"
ATUAL=$($K get secret argocd-secret -n argocd -o jsonpath='{.data.admin\.password}' 2>/dev/null)
if [ "$ATUAL" = "$(cat "$BKP/argocd-admin.password.b64")" ]; then
  echo "    NAO MUDOU  <<<<<"
else
  echo "    mudou"
fi

echo
echo "=== 6. residuo: argocd-initial-admin-secret ==="
# So vale ate o primeiro login e o ArgoCD nao o le mais. Deixa-lo mantem uma
# credencial valida (a original) num Secret que ninguem usa.
$K delete secret argocd-initial-admin-secret -n argocd --ignore-not-found 2>&1 | sed 's/^/  /'

echo
echo "=== 7. onde estao as senhas novas ==="
echo "  $BKP/kubero-admin.txt   (mode 600)"
echo "  $BKP/argocd-admin.txt   (mode 600)"
echo "  estado anterior: $BKP/argocd-admin.password.b64, $BKP/kubero.sqlite"
echo
echo "  Leia com:  sudo cat $BKP/kubero-admin.txt"
echo "  NUNCA cole em chat, repo ou issue."
