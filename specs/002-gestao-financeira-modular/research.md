# Research: Gestão Financeira Modular

Todas as incógnitas da feature têm precedente direto no repositório —
nenhuma pesquisa externa foi necessária além de confirmar o padrão já
usado por serviços análogos. Nenhum item ficou marcado como
NEEDS CLARIFICATION.

## 1. Como os 4 módulos persistem sem banco próprio

**Decision**: Cada um dos 4 microsserviços (`contas-api`,
`transacional-api`, `asset-manager-api`, `dashboard-api`) não tem driver de
banco de dados. Toda escrita e leitura passa por HTTP para a `domain-api`
compartilhada, autenticado por `X-API-Key` própria por serviço (uma entrada
nova em `local.domain_api_keys`), exatamente como `cch-api` faz hoje para
`cch_rooms`/`cch_custom_decks`.

**Rationale**: É o pedido explícito do usuário ("todos persistem dados
usando o domain-api") e já é um padrão comprovado em produção — zero
ambiguidade, zero necessidade de inventar algo novo.

**Alternatives considered**:
- *Banco próprio por serviço* (padrão `bet-api`, tabelas `bet_*` no mesmo
  Postgres compartilhado, mas com driver/migrations próprios): rejeitado
  porque contraria o pedido explícito do usuário de rotear tudo pela
  domain-api.
- *Um serviço único “finance-api” em vez de 4*: rejeitado porque o usuário
  pediu explicitamente 1 microsserviço por módulo.

## 2. Escolha de escrita síncrona (`/sync`) vs. assíncrona (`202`) por operação

**Decision**:
- **Síncrono (`POST /sync`, confirmação por `audit_log`)**: criar/editar
  conta, criar/editar ativo, registrar compra/venda de ativo, salvar layout
  de dashboard — operações onde a pessoa usuária espera ver o resultado
  imediatamente na tela seguinte (mesma razão do `cch-api` usar `/sync`
  para criar/apagar sala).
- **Assíncrono padrão (`202`)**: lançar uma transação do dia a dia,
  registrar recebimento de provento — alto volume, a UI já otimiza
  localmente (optimistic update) e não precisa bloquear na confirmação de
  escrita.

**Rationale**: Segue a régua já documentada no README da `domain-api`
("use o caminho 202 padrão a menos que o chamador literalmente não possa
prosseguir sem a escrita durável") e o precedente do `cch-api` (estrutural
= `/sync`, contagem de plays = `202`).

**Alternatives considered**: usar `/sync` para tudo (mais simples de
raciocinar, mas ignora a recomendação explícita da domain-api de reservar
`/sync` para o caso excepcional; adicionaria latência desnecessária ao
lançamento de transações, que é o fluxo de uso mais frequente).

## 3. Cotações de mercado (brapi.dev)

**Decision**: O cliente HTTP para `https://brapi.dev/api/quote/{tickers}`
vive só em `asset-manager-api` (`internal/quotes`), nunca em
`domain-api`/`domain-worker` (que não fazem chamadas a serviços externos
hoje). O token de acesso é lido de uma env var
(`ASSET_MANAGER_BRAPI_TOKEN`), injetada pelo Terraform como segredo —
nunca commitado no código ou nesta documentação. As cotações obtidas são
cacheadas em memória no processo com TTL curto (poucos minutos, compatível
com SC-004 ≤ 15 min de atraso) para não estourar o limite de requisições do
plano gratuito, e o último valor conhecido é também persistido via
domain-api (agregado `ativo`) para sobreviver a um restart do processo e
atender FR-035 (mostrar cotação desatualizada em vez de quebrar a tela).

**Rationale**: Plano gratuito da brapi.dev tem rate limit por
minuto/dia — buscar a cotação a cada request de tela não escala e pode
estourar o limite com poucos ativos. Cache + fallback para último valor
conhecido resolve tanto o limite de uso quanto o edge case de
indisponibilidade (FR-035, edge case do spec).

**Alternatives considered**:
- *Buscar cotação em tempo real a cada request*: rejeitado, risco de
  estourar rate limit do plano gratuito com poucos usuários simultâneos.
- *domain-worker consultar a brapi.dev diretamente ao processar comandos*:
  rejeitado — quebraria a responsabilidade única do domain-worker (hoje
  100% persistência, zero chamada de rede a terceiros) e acoplaria um
  segredo de um módulo específico a um serviço compartilhado por todos os
  módulos do repositório.

## 4. Upload de imagem de comprovante (preparação para OCR futuro)

**Decision**: Nesta fase, a imagem é enviada pelo frontend para
`transacional-api`, validada (tamanho/formato) e repassada como campo de
anexo (base64) dentro do comando de criação/edição de transação na
`domain-api`, sem infraestrutura de storage de objetos nova. Um limite de
tamanho (poucos MB) é aplicado antes do envio.

**Rationale**: Já existe precedente de anexar binário como base64 dentro
de um payload de comando/evento no repositório (`bet-runner` manda
screenshot jpeg em base64 no receipt do `/internal/jobs/:id/result`) — reusa
o padrão em vez de introduzir um bucket novo (MinIO) só para poucos
comprovantes por dia, o que seria overengineering para o MVP descrito no
spec (upload apenas guarda o arquivo; o OCR em si é explicitamente fora de
escopo).

**Alternatives considered**: bucket MinIO dedicado para comprovantes (mesmo
padrão dos sites estáticos) — deixado como evolução natural quando o OCR
for implementado de fato e o volume/tamanho de imagens justificar sair do
Postgres compartilhado; documentar isso evita re-trabalho de protocolo de
API quando migrar (o campo já é "anexo", não "base64 obrigatório").

## 5. Autenticação e login único com o resto do ecossistema

**Decision**: Cada um dos 4 backends ganha sua própria aplicação
Cloudflare Access (mesmo time/Google SSO dos outros apps), com o mesmo
middleware de validação de JWT copiado do padrão `bet-api`/`harness-api`
(`Cf-Access-Jwt-Assertion` validado contra o JWKS do time, `aud` da app,
allowlist de e-mails redundante). O frontend único (`financas-frontend`)
fica com o hostname bare público (como o `hub`/`bet-frontend`), e ganha uma
Cloudflare Access application escopada ao path `/sso` (mesmo truque do
hub) para permitir uma sonda de login sem exigir Access em toda a SPA
estática. Como é o mesmo team Cloudflare Access dos demais apps, a sessão
de login é única em todo o ecossistema (a pessoa loga uma vez, todos os
apps reconhecem).

**Rationale**: Reaproveita 100% um padrão já em produção em 2 apps
diferentes (`bet-api`, `harness-api`) e resolve exatamente o requisito
FR-001/FR-002/FR-003 do spec sem inventar um sistema de auth novo.

**Alternatives considered**: sistema de login próprio (usuário/senha
armazenado no próprio produto) — rejeitado, o repo não tem esse padrão em
nenhum app existente e adicionaria uma superfície de segurança nova
(hash de senha, recuperação de conta) sem necessidade, já que o Cloudflare
Access resolve autenticação de forma centralizada para todo o portfólio.

## 6. Frontend único: hospedagem e integração com o hub

**Decision**: `financas-frontend` é um SPA React + Vite + TypeScript com
Tailwind, buildado estaticamente e espelhado num bucket MinIO (exatamente
como `tela-frontend`), servido pelo `compute/services/ingress`, sem
container próprio rodando. Registrado no hub (`hub-frontend/src/lib/apps.ts`)
como um `Microfrontend` (mesma categoria de `bet`), abrindo em iframe a
partir de `hub.giomartins.dev`, com o tema do hub propagado via o mesmo
bridge (`lib/hubTheme.ts`) usado pelos outros microfrontends que optam por
ele — mas com uma linguagem visual própria e autoral por dentro (não um
clone do hub), atendendo ao pedido de UI "fora da caixinha".

**Rationale**: É exatamente o padrão que o usuário pediu explicitamente
("o front tem que seguir o padrão do tela... vai estar também no hub") e
evita reinventar pipeline de deploy (CI/CD, bucket, ingress já existem
prontos para esse formato).

**Alternatives considered**: 1 frontend por módulo (4 SPAs) — rejeitado,
o usuário pediu "1 fe" (frontend único) cobrindo os 4 módulos, com 4
backends por trás dele.
