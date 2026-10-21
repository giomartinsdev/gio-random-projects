# Teardown de produto + mapa de oportunidade: football management no Reino Unido

**Data:** 20 de outubro de 2026
**Escopo:** análise pública de produto do gênero *football management / chairman sim*, e onde um
novo entrante cabe no mercado britânico. Nada aqui deriva de acesso não autorizado, engenharia
reversa ou material proprietário de terceiros.

---

## 0. O que este documento NÃO é

Não é um teardown do Brasileirinho FC. Analisei o gênero e o mercado UK. O motivo é
prático, não só legal: o Brasileirinho é um produto de **futebol brasileiro** (278 clubes,
7.290 jogadores, estaduais, Copa do Brasil). Copiar a *estrutura* dele para o Reino Unido
significa copiar a parte que não importa e ignorar a parte que decide o sucesso — a
pirâmide inglesa, a cultura de non-league e o jeito britânico de pagar por jogos.

Também vale registrar o que é e não é protegido, porque isso define o que você pode fazer:

| Elemento | Protegido? | O que significa na prática |
|---|---|---|
| Mecânicas, loop, economia | **Não** | Você pode fazer um jogo com packs, ligas, progressão, energia. Ideia não tem copyright. |
| Código-fonte | **Sim** | Reescrever do zero é obrigatório. Copiar = infração. |
| Arte, UI, ícones, som | **Sim** | Precisa de arte própria ou licenciada. |
| Textos, nomes de competições, marca | **Sim** | "Brasileirinho" não é seu. Nome, logo e trade dress também não. |
| Nomes/escudos de clubes reais | **Sim, e caro** | Licença por liga e por clube. Ver §4. |

---

## 1. O mercado, em números

### Tamanho e dinâmica

| Indicador | Valor | Fonte |
|---|---|---|
| Mercado UK de games (consumo, 2025) | **£8,76 bi** (+7,4% a/a) | Ukie, abr/2026 |
| Software | £6,03 bi (+7%) | Ukie |
| **Mobile** | **£2,07 bi** (+7,9%) | Ukie / Omdia |
| Receita mobile UK 2025 (ERA) | £1,88 bi, 35,5% do total de games | ERA, jan/2026 |
| 5º maior mercado do mundo; 7% do gasto global | — | Ukie Key Facts 2026 |
| Jogo mais vendido de 2025 no UK | **EA Sports FC 26**, ~1,97 mi de unidades | ERA |

Duas leituras que importam:

1. **Mobile cresce em receita mesmo com downloads em queda** (Ukie diz explicitamente
   "monetisation rising across all business models... despite a year on year decline in
   downloads"). Ou seja: o dinheiro está em extrair mais de quem já joga, não em aquisição
   barata. Isso é hostil a um clone de aquisição em massa e favorável a um produto de nicho
   com retenção alta.
2. **O apetite por futebol é absurdo e é anual.** Um único jogo de futebol vende ~2 milhões
   de cópias por ano num país de 68 milhões. A demanda não é o problema. A diferenciação é.

### Concorrentes relevantes (e o que cada um deixa na mesa)

| Produto | Modelo | Força | Brecha que deixa |
|---|---|---|---|
| **Football Manager 26/27** (SI/Sega) | £45–55 premium, PC/console; Mobile incluso no Netflix | Base de dados absoluta, licenças, marca | Curva de aprendizado brutal; mobile "retro"; não é jogo de sessão curta |
| **Top Eleven** (Nordeus/Take-Two) | F2P + IAP (inclui random items) | 300 mi+ registros, 3D, PvP em tempo real | Progressão lenta e pay-to-win percebido; impessoal — você gerencia "um clube" |
| **EA Sports FC Mobile** | F2P + IAP agressivo | Licenças, marca, ~590k DAU no UK (Q4/25) | Não é management; é card collection com partida |
| **Football Chairman / Pro 2** (Underground Creative) | Freemium / £5,99–6,99 | 3 mi+ downloads, 7 divisões, **você é o chairman** | Visual datado; texto puro; sem camada social; sem live ops |
| **Club Chairman, Football Owner 2, Club Boss** | F2P/premium baixo | Ocupam o nicho "chairman casual" | Produção fraca, retenção baixa, sem profundidade real |

**A brecha mais clara:** existe um vácuo entre o *Football Chairman* (£6, uma vez, texto,
3 milhões de downloads, visual de 2014) e o *FM* (£50, 200 horas de planilha). Ninguém
ocupou esse meio com **produção moderna, sessão de 5 minutos, e uma identidade regional
forte**. E "identidade regional forte" no futebol inglês tem um nome: **non-league**.

Fonte dos números de concorrentes: Sensor Tower (Q4/2025 e Q3/2025, via blog público),
listagens da App Store/Google Play, PocketGamer.

### Por que "non-league" é o ângulo, e não a Premier League

- A Premier League é o ativo mais caro do esporte em games (ver §4). Começar por ela é
  começar pelo impossible mode.
- Non-league tem uma cultura real e apaixonada no UK: 5º/6º escalão com públicos de 1.000–4.000,
  rivalidades de cidade, promessas de "subir sete divisões", o romance do clube falido.
  É o enredo do *Football Chairman* — que vendeu 3 milhões — e ninguém o fez com produção
  moderna.
- Você pode ser **100% fictício e ainda assim autêntico**: nomes inventados, mas com a
  gramática certa (Rovers, Athletic, United, County; "the Linnets", "the Badgers"), estádios
  com capacidade de 2.000–9.000, £8 de ingresso, patrocínio da imobiliária local. Isso
  elimina o custo de licença **e** cria IP próprio.
- FPL tem **11 milhões de jogadores** e o futebol fantasy é a porta de entrada cultural para
  "gerenciar com dados". É um público já educado em tomar decisões semanais sobre futebol.

---

## 2. Teardown do loop (o que faz o gênero funcionar)

Dissecando o gênero — não um produto específico — o loop que sustenta retenção tem
cinco camadas. A ordem importa: cada uma só funciona se a anterior existir.

1. **Decisão com consequência legível.** Escalar, contratar, escolher mentalidade. O jogador
   precisa conseguir dizer *por que* ganhou ou perdeu. Simulações opacas matam o gênero.
2. **Ciclo curto de resultado.** Uma partida, um resultado, uma tabela que muda. É o
   equivalente ao "number go up" — mas com narrativa.
3. **Ciclo médio de ambição.** Temporada → promoção → divisão maior → custos maiores.
   A promoção é o *payoff* emocional central.
4. **Ciclo longo de identidade.** O clube vira *seu*: nome, cores, estádio, história,
   troféus. É o que faz alguém voltar em 30 temporadas.
5. **Fricção econômica honesta.** Dinheiro apertado, escolhas dolorosas. Sem isso, a
   decisão da camada 1 não tem peso.

**Onde os concorrentes falham:** o FM entrega 1–3 e sacrifica 5 (você nunca sente aperto
de verdade); o Top Eleven entrega 2–4 mas trai 1 (pay-to-win torna a decisão irrelevante);
o Football Chairman entrega 1, 3, 5 e sacrifica produção e camada 4 (sem live ops, sem
identidade visual).

**A síntese vencedora:** loop 1–5 completo, sessão de 5 minutos, produção 2026, mundo
fictício com identidade regional. É exatamente o que o protótipo em
`prototypes/nonleague-gm/` implementa.

---

## 3. O que construí (e o que ele prova)

Protótipo jogável em `prototypes/nonleague-gm/`, React + TS, sem backend, roda offline.

**Prova os pontos 1–5 acima, com testes:**

- **Engine de partida calibrado contra futebol real.** Modelo de Poisson com vantagem de
  casa e penalidade de mismatch. Medido em 2.000 simulações: 44,9% vitória em casa / 22,8%
  empate / 32,4% fora, 2,89 gols/jogo. Referência da liga inglesa: ~45/25/30, ~2,7. Um time
  30 pontos mais forte vence 89% — e a curva foi endurecida porque 83% era frouxo demais.
- **Pirâmide que não quebra nas bordas.** Double round-robin de 380 jogos, 2 sobem + 1 via
  play-off, 3 descem. O topo não promove e o fundo não rebaixa — é onde implementações
  ingênuas estouram.
- **Economia que dói na medida.** Bilheteria + patrocínio + prize money vs. salários e
  custos fixos. Clube de meio de tabela fecha a temporada em −£18k; campeão lucra £328k e
  sobe; lanterna perde £43k. Sem isso o jogo não tem tensão.
- **Determinismo de save.** PRNG com seed + cursor. O mesmo save sempre dá o mesmo próximo
  jogo — condição para o jogador confiar que a tática importou.
- **63 testes** cobrindo positivo, negativo e borda, escritos antes da implementação.

**O que ainda não está lá:** persistência em servidor, multiplayer/ligas entre amigos,
live ops, arte final, e a camada de identidade (nomear o clube, escudo, hino). O protótipo
é a *prova de diversão*, não o produto.

---

## 4. Licenciamento: o muro que mata clones

Este é o ponto onde a maioria dos planos de "clone de jogo de futebol" morre, e não é no código.

- **EA paga cerca de £488 mi (~$588 mi) só pela Premier League** (relatado em 2023), e tem
  contrato de lead partner desde 2016/17, com licença de jogo desde 1998/99. A Premier League
  é *exclusiva* da EA na simulação.
- **FIFPRO** cobre milhares de nomes e likenesses de jogadores. **Bundesliga** renovou em
  ago/2026 com direitos exclusivos de simulação para Bundesliga 1 e 2.
- A própria EA **não tem** licença da liga brasileira doméstica (direitos negociados
  individualmente) — o que mostra como o emaranhado é irregular por país.
- Consequência prática: **usar clube real, escudo real ou jogador real sem licença é
  violação de marca e de direitos de imagem**, além de quebra de contrato de plataforma.
  "Fair use" não cobre um jogo comercial inteiro.

**A saída — e ela é boa, não um consolo:** mundo fictício. Você não paga licença, não pode
ser derrubado, e constrói IP que é seu. O Football Chairman fez exatamente isso e tem 3
milhões de downloads. Se um dia quiser clubes reais, o caminho é licenciar **uma liga
inteira** (não clubes avulsos) e só depois de ter tração — ou fazer acordos individuais com
clubes de divisões baixas, que são baratos e adoram exposição.

---

## 5. Regulatório UK (o que ninguém lembra e derruba lançamento)

| Tema | Regra | Impacto no design |
|---|---|---|
| **Loot boxes** | ASA: listagens na App Store/Google Play **devem declarar** loot boxes de forma proeminente ("contains loot boxes"). Monitoramento ativo desde **26/mai/2026**, com enforcement. Rótulo "offers in-app purchases" **não basta**. Rulings recentes: F1 Clash, Marvel Contest of Champions, Hero Wars (nov/2025). | Se você tiver pack de cartas aleatório, o texto da loja tem que dizer isso no topo. Melhor: **vender conteúdo determinístico** (passe de temporada, skins, cenários) e evitar random items. |
| **Gambling** | Governo UK decidiu **não** tratar loot boxes como gambling (2022), mas o escrutínio continua. | Odds publicadas, limites de gasto, controle parental se houver menores. |
| **Idade / dados** | ICO **Age Appropriate Design Code** (em vigor desde set/2021). UK GDPR. | Se o jogo pode atrair menores (futebol atrai), defaults de privacidade altos, sem perfilamento agressivo, sem nudges de gasto. |
| **PEGI** | Classificação por idade; no UK administrada pelo VSC Rating Board. | Planeje o rating antes de asset final — afeta loja e marketing. |
| **Publicidade** | CAP Code também vale para anúncios de jogo em social/app store. | Nada de "grátis" se há paywall; nada de odds enganosas. |
| **Consumidor** | DMCC Act 2024 (regras de práticas desleais e reviews). | Sem dark patterns de cancelamento, sem reviews falsas. |

**Recomendação de monetização:** premium barato (£4,99–7,99, como o Football Chairman) **ou**
F2P com passe de temporada e cosméticos determinísticos. Evita a área mais regulada, alinha
com o hábito britânico de pagar uma vez (45% da receita de games no UK é compra, não
assinatura — ERA), e não depende de aquisição paga num mercado onde downloads caem.

---

## 6. Mapa de oportunidade — 5 apostas concretas

Ordenadas por custo/retorno para um time pequeno.

### Aposta 1 — "Non-League Chairman" moderno (a mais direta)
O vácuo entre Football Chairman (£6, datado) e FM (£50, inacessível). Sessão de 5 min,
estética 2026, mundo fictício, sete divisões, promoção como payoff.
**Monetização:** premium £5,99 + expansões de liga £1,99.
**Validação:** o protótipo já existe. Próximo passo é 20 pessoas jogando 3 temporadas.

### Aposta 2 — "The 92" (coleção histórica)
Gerenciar a temporada de um clube fictício *através das décadas*, com regras e economias de
cada época (salário máximo, terraces, Bosman). Apela ao torcedor nostálgico de 35–55, que é
quem paga premium no UK.
**Diferencial:** ninguém faz gestão de futebol como *jogo de história*.

### Aposta 3 — Liga privada entre amigos (social assíncrono)
O modo que o FM tem e o mobile não tem bem feito: 8–12 amigos, uma liga, uma rodada por dia,
notificações no WhatsApp/Discord. Retenção por compromisso social, não por FOMO de IAP.
**Custo técnico:** backend + push. É o item mais caro e o de maior retenção.

### Aposta 4 — "Club in Crisis" (narrativa de recuperação)
Você assume um clube falido, com dívida, estádio interditado e torcida revoltada. Objetivo
não é subir, é **sobreviver**. Encurta a fantasia para uma temporada e vira jogo de mesa.
**Formato:** premium, 3–5 horas, ótimo para portfólio e para Steam.

### Aposta 5 — Ferramenta, não jogo (B2B)
Um simulador de cenários para conteúdo: criadores de futebol, podcasts, fantasy. "E se o
clube X tivesse contratado Y?" — engine de simulação como API. Menos glamouroso, receita
mais previsível, e o ativo (a engine calibrada) você já tem.

**Minha recomendação:** Aposta 1 como produto, Aposta 4 como prova de conceito barata para
validar a engine narrativa, Aposta 3 como fase 2 se a retenção orgânica aparecer.

---

## 7. Próximos passos sugeridos

1. **Playtest do protótipo** com 10–20 pessoas do público UK (r/soccer, Discord de non-league,
   FPL communities). Medir: quantas temporadas jogam, onde param, o que explicam do resultado.
2. **Decidir monetização** (premium vs. F2P determinístico) — isso define o resto da
   arquitetura, inclusive se haverá backend.
3. **Fechar o mundo fictício**: 40 clubes, 6 divisões, nomes e cores, uma "bíblia" de canon.
4. **Só então** arte final e loja (com disclosure de loot box se houver, e rating PEGI).
5. **Licença**: não antes de tração. Se vier, liga inteira de divisão baixa, nunca clube avulso.

---

## Fontes

- Ukie, *UK Games Market Consumer Valuation 2025* (abr/2026) — £8,76 bi; mobile £2,07 bi.
- ERA, receita 2025 (jan/2026) — £5,4 bi; mobile £1,88 bi; FC 26 ~1,97 mi unidades.
- Ukie Key Facts 2026 — 7% do mercado global, 26 mil empregos.
- Sensor Tower, *Top Sports Games UK Q4 2025* e *Top 5 Sports Apps Europe Q3 2025*.
- Football Manager (SI/Sega), páginas oficiais FM26/FM27.
- Top Eleven (Nordeus/Take-Two), App Store/Google Play, release Bundesliga 2025/26.
- Football Chairman / Pro 2 (Underground Creative), App Store/Google Play — 3 mi+ downloads.
- Premier League / EA Sports — parceria e licença; relato de £488 mi (Game Developer, 2023).
- Inside World Football — Bundesliga renova com EA (ago/2026); CBF/EA (mai/2026).
- ASA — *Enforcement Notice: Disclosure of loot boxes in app stores* (fev/2026); rulings 2023–2026.
- GOV.UK — resposta à consulta sobre loot boxes (2022).
- ICO — Age Appropriate Design Code.
