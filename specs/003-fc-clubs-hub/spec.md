# Feature Specification: FC Clubs Hub

**Feature Branch**: `003-fc-clubs-hub`

**Created**: 2026-09-22

**Status**: Draft

**Input**: User description: "Hub de Pro Clubs (EA Sports FC 27) — rankings e histórico que
a EA não guarda. Home pública com anúncios e ranking global (clubes e jogadores); perfil do
clube com elenco, partidas e números; perfil do jogador; tracker de evolução com snapshots;
head-to-head; login opcional que sincroniza os clubes da pessoa, os rivais deles e os rivais
dos rivais em segundo plano; notificações no Discord; e uma área de administração com todo o
conteúdo técnico. Tudo visível sem login, com login opt-in. Já existe um design system
completo (56 componentes, 26 telas em dark e light) e um mock navegável com as 18 rotas."

## Contexto

A API pública da EA (`proclubs.ea.com/api/fc`) entrega **apenas o estado atual** de cada
clube mais as ~10 partidas mais recentes por tipo. Qualquer coisa "ao longo do tempo" —
nível, divisão, recordes, evolução de jogador — **não existe do lado da EA** e precisa ser
construída acumulando leituras ao longo do tempo. Este hub existe para ser essa memória, e
para apresentá-la de forma que qualquer pessoa entenda.

Esta é a tradução do protótipo (`modules/apps/clubs-frontend/`, mock determinístico) e do
design system (`ui.pen`) para um produto real no ar.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver o ranking global e os anúncios (Priority: P1)

Uma pessoa visitante chega ao hub sem ter conta. Ela vê imediatamente uma home com anúncios
(últimos resultados, quem lidera o ranking, novidades) e o ranking global do servidor, tanto
por clube quanto por jogador, podendo trocar a métrica (nível, pontos, vitórias %, gols) e
alternar entre as duas visões.

**Why this priority**: É a porta de entrada e o que dá razão para existir o produto. Não
depende de login nenhum e entrega valor na primeira visita — é o que faz alguém voltar.

**Independent Test**: Abrir a home sem autenticação alguma e conferir que anúncios e os dois
rankings renderizam com dados reais vindos da base, com as métricas trocando e as linhas
clicáveis levando ao perfil correspondente.

**Acceptance Scenarios**:

1. **Given** uma pessoa visitante abre o hub sem estar autenticada, **When** a home carrega,
   **Then** ela vê anúncios e o ranking global de clubes ordenado por nível, com nome,
   divisão, campanha e forma visíveis.
2. **Given** a pessoa visitante está na home, **When** ela alterna o ranking para jogadores,
   **Then** a lista passa a mostrar jogadores com clube, posição e nota média, ordenada por
   nota.
3. **Given** a pessoa visitante troca a métrica do ranking de clubes para "pontos", **When**
   a lista reordena, **Then** a ordem reflete a nova métrica sem recarregar a página.
4. **Given** a base ainda não tem partidas sincronizadas de nenhum clube, **When** a home
   carrega, **Then** ela exibe um estado vazio explicativo em vez de quebrar ou mostrar
   números inventados.

---

### User Story 2 - Explorar qualquer clube, partida e jogador (Priority: P1)

A pessoa visitante procura um clube pelo nome, abre o perfil dele e navega por elenco,
partidas e números. De qualquer linha de jogador ela abre o perfil daquele jogador, e de
qualquer partida abre a súmula com quem jogou nos dois lados, os lances e os números do jogo.
Tudo isso sem autenticação.

**Why this priority**: É o miolo do produto — o que diferencia de um ranking estático. Sem
esta navegação o hub é só uma tabela.

**Independent Test**: Buscar um clube, abrir o perfil, percorrer as quatro abas, abrir uma
partida a partir da lista de partidas e abrir um jogador a partir da súmula daquela partida,
conferindo que os dados batem entre as telas.

**Acceptance Scenarios**:

1. **Given** a pessoa visitante digita parte de um nome de clube, **When** a busca responde,
   **Then** clubes cujo nome contém o texto aparecem, incluindo quando a pessoa digita sem
   acento (ex.: "uniao" encontra "União").
2. **Given** a pessoa visitante abre o perfil de um clube acompanhado, **When** a tela
   carrega, **Then** ela mostra campanha, divisão atual e melhor, nível, sequências e as
   últimas partidas.
3. **Given** a pessoa visitante está na aba de elenco, **When** ela clica em um jogador,
   **Then** o perfil do jogador abre com forma recente, gols por jogo, acerto de passe e —
   no caso de goleiro — o detalhamento de defesas por tipo.
4. **Given** a pessoa visitante está em uma partida, **When** a súmula carrega, **Then**
   ela vê as duas equipes com a nota de cada jogador, a linha do tempo de lances e o
   comparativo de estatísticas entre os times.
5. **Given** a pessoa visitante abre um clube que o hub ainda **não** acompanha, **When** a
   tela carrega, **Then** ela vê apenas os totais gerais disponíveis e uma explicação clara
   de que o elenco e as partidas ainda não foram trazidos — nunca uma tela vazia sem
   explicação.

---

### User Story 3 - Acompanhar a evolução e os recordes do clube (Priority: P2)

A pessoa visitante abre a área de números de um clube e vê como o nível evoluiu ao longo do
tempo, quando o clube subiu ou caiu de divisão, quais recordes já bateu (maior goleada,
maior sequência, melhor nota individual) e como se sai contra cada rival.

**Why this priority**: É o que justifica o produto existir — a EA não guarda esse histórico.
Mas depende de dados já acumulados, então só entrega valor pleno depois do ingest rodar por
algum tempo.

**Independent Test**: Abrir a aba de números de um clube, conferir o gráfico de evolução, a
lista de mudanças de divisão, os recordes e o comparativo com um rival escolhido.

**Acceptance Scenarios**:

1. **Given** o hub já acumulou mais de uma leitura de um clube, **When** a pessoa abre a
   evolução, **Then** ela vê o nível ao longo do tempo, com pico, fundo e a variação recente.
2. **Given** um clube mudou de divisão entre duas leituras, **When** a pessoa abre o
   histórico de divisões, **Then** a subida ou queda aparece como um evento datado.
3. **Given** a pessoa abre os recordes, **When** a lista carrega, **Then** ela vê a maior
   goleada, a pior derrota, o jogo com mais gols, a melhor nota individual e a maior
   sequência de vitórias, cada um com adversário e data.
4. **Given** a pessoa escolhe um rival no comparador, **When** o confronto carrega, **Then**
   ela vê o retrospecto direto (vitórias, empates, derrotas, gols) e a comparação de
   estatísticas entre os dois clubes.
5. **Given** o hub só tem uma leitura de um clube, **When** a pessoa abre a evolução,
   **Then** a tela mostra o valor atual e explica que o histórico cresce a cada atualização,
   em vez de desenhar um gráfico degenerado.

---

### User Story 4 - Entrar e ter os próprios clubes sincronizados (Priority: P2)

A pessoa entra com o Google e o hub descobre os clubes dela, os rivais desses clubes e os
rivais dos rivais, trazendo tudo sozinho em segundo plano. Ela acompanha o progresso
enquanto navega e, ao terminar, esses clubes ficam completamente navegáveis. Ela também pode
seguir clubes e reivindicar o próprio pro.

**Why this priority**: É o que transforma o hub de "consulta" em "meu hub". Mas o produto é
plenamente usável sem isso, então vem depois do caminho crítico público.

**Independent Test**: Entrar, observar o indicador de sincronização progredir pelos três
níveis, e ao final conferir que clubes que antes apareciam apenas como agregado agora têm
elenco e partidas navegáveis.

**Acceptance Scenarios**:

1. **Given** a pessoa visitante aciona "Entrar com Google", **When** o login conclui, **Then**
   ela volta ao hub autenticada, sem perder a tela onde estava.
2. **Given** a pessoa acabou de entrar, **When** a sincronização começa, **Then** um
   indicador mostra o progresso por nível (seus clubes, rivais diretos, rivais dos rivais)
   sem bloquear a navegação.
3. **Given** a sincronização terminou, **When** a pessoa abre um dos clubes descobertos,
   **Then** ele tem elenco, partidas e números completos, como qualquer clube já conhecido.
4. **Given** a pessoa segue um clube, **When** ela recarrega o hub, **Then** o clube
   continua seguido e aparece na lista dela.
5. **Given** a pessoa reivindica o próprio pro, **When** ela abre a página daquele jogador,
   **Then** aparece a marca de verificado.
6. **Given** a sessão da pessoa expirou, **When** ela tenta acessar a própria área, **Then**
   o hub a convida a entrar novamente, sem quebrar a página nem vazar dado de outra pessoa.

---

### User Story 5 - Receber avisos no Discord e ver o estado técnico (Priority: P3)

A pessoa que entrou escolhe quais avisos quer receber no Discord do clube (resumo semanal,
recordes e divisões, partidas). Separadamente, quem administra o hub acessa uma área restrita
com o estado técnico: integração com a EA, cache, histórico acumulado, experimentos e as
decisões de arquitetura.

**Why this priority**: Fecha o ciclo de retenção e dá manutenção ao produto, mas nada disso
bloqueia o uso normal.

**Independent Test**: Ligar os avisos, disparar um evento (ex.: uma partida nova) e conferir
a mensagem chegando no canal; depois abrir a área de administração com uma conta autorizada e
conferir os painéis técnicos.

**Acceptance Scenarios**:

1. **Given** a pessoa está autenticada, **When** ela liga o resumo semanal, **Then** a
   preferência persiste e o hub passa a enviar o resumo no canal configurado.
2. **Given** o clube bate um recorde, **When** o hub detecta isso, **Then** uma mensagem vai
   para o canal configurado, se o aviso estiver ligado.
3. **Given** uma pessoa sem permissão de administrador tenta abrir a área restrita, **When**
   a rota carrega, **Then** ela vê uma mensagem de acesso restrito e nenhum dado técnico.
4. **Given** a pessoa administradora abre a administração, **When** os painéis carregam,
   **Then** ela vê quantos clubes estão acompanhados, quantos pendentes, o volume de
   partidas e o estado do cache por tipo de consulta.

---

### Edge Cases

- O que acontece quando a EA fica indisponível ou passa a bloquear o worker? O hub deve
  continuar servindo o último dado conhecido, marcando-o como desatualizado, em vez de
  quebrar ou servir dado inventado.
- O que acontece quando o hub encontra um clube mas nunca consegue buscar partidas dele? Ele
  aparece como agregado conhecido, com indicação explícita de que não foi acompanhado.
- Como o sistema se comporta quando o payload da EA muda de forma (campo novo, campo
  ausente)? A consulta daquele clube falha isoladamente e é registrada, sem derrubar o ciclo
  inteiro nem poluir a base.
- O que acontece se a pessoa tentar entrar e o provedor de login estiver indisponível? O hub
  continua plenamente navegável como visitante, sem erro bloqueante.
- O que acontece quando a pessoa sai no meio de uma sincronização? O progresso pendente é
  descartado e pode ser refeito na próxima entrada, sem estado inconsistente.
- Como o sistema trata uma partida decidida por desistência (DNF)? Ela conta como vitória
  para quem ficou, e isso precisa ficar visível para não parecer um placar normal.
- O que acontece quando dois clubes jogam entre si e a mesma partida é vista de dois lados?
  Ela deve existir uma única vez na base, aparecendo corretamente para os dois.
- Como o sistema trata números que a EA envia como texto, e códigos de resultado sem tabela
  publicada? Devem ser normalizados numa camada única, nunca espalhados pela aplicação.

## Requirements *(mandatory)*

### Functional Requirements

**Leitura pública (sem login)**

- **FR-001**: O sistema DEVE permitir que qualquer visitante não autenticado veja a home,
  os rankings globais de clubes e jogadores, o diretório de clubes, o índice de jogadores e
  os perfis públicos de clube, jogador e partida.
- **FR-002**: O sistema DEVE permitir busca de clube por nome, ignorando diferenças de
  maiúsculas e acentuação.
- **FR-003**: O sistema DEVE apresentar, para cada clube acompanhado, campanha, divisão atual
  e melhor divisão, nível, sequências e as partidas recentes.
- **FR-004**: O sistema DEVE apresentar o elenco de um clube com, no mínimo, jogos, gols,
  assistências, nota média e overall por jogador.
- **FR-005**: O sistema DEVE apresentar, por partida, o placar, o adversário, o tipo de
  partida, a marcação de desistência quando houver, e a linha de cada jogador dos dois times
  com nota, gols, assistências e minutos.
- **FR-006**: O sistema DEVE apresentar, por jogador, temporada e carreira, forma recente,
  gols por jogo, acerto de passe e desarme e, para goleiros, o detalhamento de defesas por
  tipo.
- **FR-007**: O sistema DEVE apresentar rankings globais ordenáveis por pelo menos nível,
  pontos, aproveitamento e gols para clubes, e nota, gols e assistências para jogadores.
- **FR-008**: O sistema DEVE deixar explícito, em qualquer clube não acompanhado, que elenco
  e partidas ainda não foram trazidos, mostrando apenas os totais gerais disponíveis.

**Histórico construído**

- **FR-009**: O sistema DEVE acumular leituras periódicas de cada clube acompanhado,
  formando séries temporais de nível e de divisão.
- **FR-010**: O sistema DEVE detectar e registrar como evento datado cada mudança de divisão
  de um clube, distinguindo promoção de rebaixamento.
- **FR-011**: O sistema DEVE calcular recordes do clube a partir do histórico persistido:
  maior goleada, pior derrota, jogo com mais gols, melhor nota individual e maior sequência
  de vitórias.
- **FR-012**: O sistema DEVE apresentar o retrospecto direto entre dois clubes, escolhido o
  rival a partir dos adversários já enfrentados.
- **FR-013**: O sistema DEVE apresentar a evolução de gols por temporada de um jogador.
- **FR-014**: O sistema DEVE computar os rankings e recordes a partir da base acumulada, não
  apenas da janela recente que a EA entrega.

**Ingestão**

- **FR-015**: O sistema DEVE buscar periodicamente, de forma automatizada, os dados dos
  clubes acompanhados — identificação, elenco, partidas e totais — sem intervenção humana.
- **FR-016**: O sistema DEVE respeitar limites de frequência por tipo de consulta,
  reutilizando a resposta recente em vez de consultar a origem a cada acesso.
- **FR-017**: O sistema DEVE normalizar, numa camada única, os formatos irregulares da
  origem: números enviados como texto, códigos de resultado, partidas amistosas sem marcação
  de resultado, e identificadores sem tabela publicada.
- **FR-018**: O sistema DEVE registrar uma partida uma única vez mesmo quando ela é vista
  pelos dois clubes envolvidos, exibindo-a corretamente para ambos.
- **FR-019**: O sistema DEVE continuar operando com o último dado conhecido quando a origem
  estiver indisponível, e retomar a atualização quando ela voltar.

**Conta e sincronização**

- **FR-020**: O sistema DEVE permitir login opt-in, sem exigir cadastro novo, e sem exigir
  autenticação para qualquer uma das telas públicas.
- **FR-021**: O sistema DEVE, logo após o login, descobrir e sincronizar em segundo plano os
  clubes da pessoa, os rivais diretos desses clubes e os rivais dos rivais.
- **FR-022**: O sistema DEVE exibir o progresso dessa sincronização sem bloquear a navegação,
  nomeando o clube em processamento e o nível corrente.
- **FR-023**: O sistema DEVE permitir seguir e deixar de seguir clubes, com a escolha
  persistindo entre sessões.
- **FR-024**: O sistema DEVE permitir reivindicar um pro, exibindo a marca de verificado
  somente para quem reivindicou.
- **FR-025**: O sistema DEVE isolar os dados de cada pessoa autenticada, de modo que
  preferências, clubes seguidos e pro reivindicado de uma não apareçam para outra.
- **FR-026**: O sistema DEVE encerrar a sessão de forma limpa, devolvendo a pessoa ao estado
  de visitante sem quebrar a tela em que ela estava.

**Notificações**

- **FR-027**: O sistema DEVE permitir que a pessoa autenticada escolha quais avisos receber,
  individualmente, e persista essa escolha.
- **FR-028**: O sistema DEVE enviar para um canal externo de mensagens, quando habilitado, o
  resumo periódico, os avisos de recorde e de mudança de divisão, e o resultado de partidas.
- **FR-029**: O sistema DEVE continuar funcionando normalmente quando o canal de notificação
  não estiver configurado ou falhar.

**Administração e qualidade**

- **FR-030**: O sistema DEVE restringir a área de administração a pessoas autorizadas,
  negando qualquer dado técnico a quem não for administrador.
- **FR-031**: O sistema DEVE apresentar, na área de administração, o estado da ingestão
  (clubes acompanhados, pendentes, volume de partidas, estado do cache por tipo de consulta).
- **FR-032**: O sistema DEVE registrar falhas de ingestão de forma que uma falha isolada em
  um clube não interrompa o ciclo nem corrompa dados já gravados.

**Interface**

- **FR-033**: O sistema DEVE oferecer a experiência completa em tema claro e escuro,
  seguindo o design system já produzido.
- **FR-034**: O sistema DEVE manter toda a interface em português, com linguagem de usuário —
  nenhum termo técnico de integração, cache ou arquitetura nas telas públicas.
- **FR-035**: O sistema DEVE concentrar todo conteúdo técnico exclusivamente na área de
  administração.
- **FR-036**: O sistema DEVE ser navegável em tela pequena, com sidebar substituída por
  navegação compacta, sem rolagem horizontal.
- **FR-037**: O sistema DEVE tornar cada clube, partida e jogador acessível por link direto,
  de modo que abrir, recarregar ou voltar no navegador mantenha a mesma tela.

### Success Criteria *(mandatory)*

**Resultados mensuráveis**

- **SC-001**: Uma pessoa visitante sem conta encontra o ranking global e chega ao perfil de um
  clube específico em menos de 3 interações.
- **SC-002**: A home responde em menos de 2 segundos no primeiro carregamento e menos de 1
  segundo nas trocas de ranking e métrica.
- **SC-003**: O hub mantém pelo menos 12 semanas de histórico contínuo de nível por clube
  acompanhado, com no máximo uma lacuna por mês por falha de coleta.
- **SC-004**: Após o login, os clubes da pessoa e seus rivais diretos aparecem navegáveis em
  menos de 5 minutos; o terceiro nível completa em até 15 minutos.
- **SC-005**: Nenhum dado de uma pessoa autenticada é visível para outra em nenhuma tela ou
  resposta de API.
- **SC-006**: Quando a origem de dados está indisponível, o hub continua servindo todas as
  telas a partir da base, com a marcação de desatualizado visível.
- **SC-007**: Um clube recém-descoberto passa de "agregado conhecido" para "completo, com
  elenco e partidas" em no máximo um ciclo de sincronização.

**Comportamento verificável**

- **SC-008**: A busca encontra clubes independentemente de acentuação e maiúsculas.
- **SC-009**: Alternar entre tema claro e escuro não deixa nenhum texto ilegível — todos os
  pares de contraste atendem ao mínimo de acessibilidade.
- **SC-010**: Todo clube, partida e jogador aberto por link direto sobrevive a um recarregar
  e ao botão voltar do navegador.

## Assumptions

- O hub serve uma comunidade pequena (poucas dezenas de clubes acompanhados); não há meta de
  alta concorrência nem de multi-inquilino.
- A janela que a origem entrega é curta (~10 partidas por tipo por clube). Todo histórico
  além disso é construído pelo hub e começa do zero quando o produto entra no ar — as telas
  precisam degradar bem enquanto o histórico é curto.
- "Todas as telas visíveis sem login, com login opt-in" foi interpretado como: **tudo que é
  público continua público**; o login serve para descobrir e sincronizar os clubes da pessoa,
  guardar preferências e acessar a área técnica. Não há conteúdo bloqueado atrás de login
  além disso.
- A área de administração é restrita a endereços autorizados; não há um sistema de papéis
  além de "administrador ou não".
- O envio de mensagens para o Discord depende de um canal configurado pela pessoa
  administradora; sem ele, o hub opera normalmente.
- Os dados exibidos são públicos por natureza (a origem é aberta); não há dado sensível de
  terceiros a proteger além das preferências de cada conta.
- A origem de dados não exige credencial hoje — apenas que a requisição se pareça com a de um
  navegador.
- O design system já produzido é a referência visual canônica; esta feature o implementa, não
  o redesenha.

## Dependencies

- **Base compartilhada de domínio** — onde clubes, partidas, jogadores, leituras históricas e
  preferências serão persistidos. Sem ela nenhuma história entrega dado real.
- **Pipeline de ingestão** — responsável por trazer e normalizar os dados da origem.
- **Provedor de identidade** — para o login opt-in e para restringir a área de administração.
- **Canal externo de mensagens** — para os avisos (opcional, desligável).
- **Design system** — `modules/apps/clubs-frontend/ui.pen`, fonte visual desta feature.
- **Client não oficial da origem de dados** — já existe, escrito em Python, com licença
  permissiva; precisa ser incorporado ao repositório com a devida atribuição.
