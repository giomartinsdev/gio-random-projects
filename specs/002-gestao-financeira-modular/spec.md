# Feature Specification: Gestão Financeira Modular

**Feature Branch**: `002-gestao-financeira-modular`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: "Software de gerenciamento financeiro completo com login, seguindo os padrões de microsserviços já existentes, com UI diferenciada. Quatro módulos: Transacional (cadastro manual de transações por conta, com upload futuro de imagem para OCR), Asset Manager (cadastro de ativos de investimento por conta, cálculo de quanto foi pago e quanto rendeu, usando cotações de mercado), Contas (criação de contas do tipo corrente ou investimento), e Dashboard (visão totalmente modular e personalizável, no estilo Grafana, sobre todos os dados do usuário)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Organizar as contas financeiras (Priority: P1)

Uma pessoa usuária entra no sistema pela primeira vez e cadastra as contas que possui na vida real (por exemplo, uma conta corrente do banco e uma conta de corretora de investimentos), informando um nome e o tipo de cada conta. Essas contas se tornam a base sobre a qual toda transação e todo ativo será organizado.

**Why this priority**: Sem contas cadastradas não existe onde lançar transações nem onde alocar ativos — este é o alicerce dos outros três módulos e precisa existir primeiro para qualquer valor ser entregue.

**Independent Test**: Pode ser testado de forma isolada criando, editando, listando e desativando/arquivando uma conta, verificando que o tipo (corrente ou investimento) fica corretamente associado e que a conta aparece disponível para uso nos outros módulos.

**Acceptance Scenarios**:

1. **Given** a pessoa usuária está autenticada e não possui nenhuma conta cadastrada, **When** ela cria uma nova conta informando nome e tipo (corrente ou investimento), **Then** a conta passa a existir e aparece na lista de contas disponíveis.
2. **Given** a pessoa usuária já possui contas cadastradas, **When** ela edita o nome de uma conta, **Then** o novo nome é refletido em todas as telas e módulos que referenciam essa conta.
3. **Given** uma conta possui transações ou ativos vinculados, **When** a pessoa usuária tenta removê-la, **Then** o sistema impede a exclusão definitiva e oferece arquivar/inativar a conta em vez disso, preservando o histórico.

---

### User Story 2 - Registrar transações do dia a dia (Priority: P2)

A pessoa usuária lança manualmente as transações que faz no dia a dia (receitas e despesas), associando cada uma a uma conta, uma data, um valor, uma categoria e uma descrição, para acompanhar para onde o dinheiro está indo.

**Why this priority**: É o uso mais frequente e recorrente do sistema (o hábito diário), e é o que alimenta os dados que tornam o dashboard e os relatórios úteis.

**Independent Test**: Pode ser testado de forma isolada cadastrando uma conta (pré-requisito da US1), lançando transações de entrada e saída nela, e conferindo que o saldo e o histórico da conta refletem corretamente os lançamentos.

**Acceptance Scenarios**:

1. **Given** a pessoa usuária tem ao menos uma conta cadastrada, **When** ela registra manualmente uma transação (valor, data, categoria, conta e descrição), **Then** a transação passa a constar no extrato da conta e no total do período.
2. **Given** uma transação foi lançada com dados incorretos, **When** a pessoa usuária edita ou exclui essa transação, **Then** os totais e extratos são recalculados imediatamente.
3. **Given** a pessoa usuária está na tela de nova transação, **When** ela aciona a opção de anexar uma imagem de comprovante/nota, **Then** o sistema aceita o upload e associa a imagem ao lançamento para uso futuro em leitura automática (OCR), mesmo que os dados da transação continuem sendo preenchidos manualmente nesta fase.
4. **Given** a pessoa usuária filtra as transações por conta, período ou categoria, **When** aplica o filtro, **Then** apenas as transações correspondentes são exibidas.

---

### User Story 3 - Visão personalizada e modular no dashboard (Priority: P3)

A pessoa usuária acessa o dashboard e enxerga, por padrão, uma visão geral pronta de sua situação financeira (saldos, gastos por categoria, evolução patrimonial). Ela pode então personalizar essa visão livremente: adicionar, remover, redimensionar e reposicionar blocos de informação (gráficos, indicadores, listas), escolher quais contas aparecem em cada bloco e trocar o tipo de visualização, compondo o próprio painel sem ajuda técnica.

**Why this priority**: É o elemento diferenciador do produto ("mágico", à la Grafana) e o que dá sentido de valor agregado a todos os dados capturados nos outros módulos — mas só entrega valor pleno depois que existem contas e transações para visualizar.

**Independent Test**: Pode ser testado de forma isolada carregando o layout padrão sobre dados de exemplo/já existentes, depois adicionando um novo bloco, redimensionando um bloco existente, removendo um bloco e confirmando que essas alterações persistem ao recarregar a tela.

**Acceptance Scenarios**:

1. **Given** a pessoa usuária acessa o dashboard pela primeira vez, **When** a tela carrega, **Then** um layout padrão com visões essenciais (saldo consolidado, gastos por categoria, evolução do patrimônio) é exibido automaticamente.
2. **Given** a pessoa usuária está no dashboard, **When** ela adiciona um novo bloco de visualização e escolhe a fonte de dados (ex.: transações de uma conta específica, ou ativos de investimento) e o tipo de visualização, **Then** o bloco passa a exibir os dados escolhidos.
3. **Given** a pessoa usuária redimensiona ou reposiciona um bloco existente, **When** ela sai e retorna ao dashboard, **Then** o layout personalizado é mantido exatamente como ela deixou.
4. **Given** a pessoa usuária remove um bloco do dashboard, **When** confirma a remoção, **Then** o bloco deixa de aparecer, sem afetar os dados subjacentes (contas/transações/ativos permanecem intactos).
5. **Given** a pessoa usuária quer recomeçar, **When** aciona a opção de restaurar o layout padrão, **Then** o dashboard volta à visão inicial padrão.

---

### User Story 4 - Acompanhar investimentos e sua rentabilidade (Priority: P4)

A pessoa usuária cadastra os ativos de investimento que possui (ações, fundos imobiliários e similares), informando em qual conta de investimento cada um está alocado, quanto e quando comprou. O sistema busca a cotação de mercado de cada ativo e calcula automaticamente quanto foi pago, o valor atual e a rentabilidade (ganho ou perda) de cada posição e da carteira como um todo.

**Why this priority**: Agrega valor real de acompanhamento patrimonial, mas depende de contas já existirem (US1) e é um módulo de uso menos frequente que o lançamento diário de transações (US2), sendo o complemento natural do dashboard (US3).

**Independent Test**: Pode ser testado de forma isolada cadastrando uma conta de investimento (pré-requisito da US1), registrando a compra de um ativo com quantidade e preço pago, e conferindo que o sistema exibe a cotação atual, o valor de mercado da posição e a rentabilidade calculada.

**Acceptance Scenarios**:

1. **Given** a pessoa usuária tem uma conta do tipo investimento, **When** ela cadastra um ativo informando ticker/código, quantidade e preço pago, **Then** o ativo passa a aparecer na carteira dessa conta com seu custo de aquisição total.
2. **Given** um ativo está cadastrado na carteira, **When** o sistema consulta a cotação de mercado mais recente disponível, **Then** o valor atual da posição e a rentabilidade (percentual e em valor) são exibidos e atualizados.
3. **Given** a cotação de um ativo não está disponível no momento da consulta (ex.: ticker inválido ou fonte de dados indisponível), **When** a tela de carteira é exibida, **Then** o sistema mostra o último valor conhecido com indicação de que está desatualizado, em vez de quebrar a tela ou mostrar dado incorreto.
4. **Given** a pessoa usuária registra o recebimento de proventos (dividendos/rendimentos) de um ativo, **When** ela lança esse recebimento, **Then** ele passa a compor a rentabilidade total daquele ativo e da carteira.
5. **Given** a pessoa usuária vende ou encerra uma posição, **When** ela registra a venda com quantidade e preço, **Then** o sistema calcula o resultado realizado dessa operação e mantém o histórico da posição encerrada.

---

### Edge Cases

- O que acontece quando a pessoa usuária tenta lançar uma transação ou cadastrar um ativo em uma conta que acabou de ser arquivada/inativada?
- Como o sistema se comporta se a fonte externa de cotações estiver temporariamente indisponível ou retornar erro para múltiplos ativos ao mesmo tempo?
- O que acontece se a pessoa usuária tentar montar um bloco de dashboard referenciando uma conta que foi excluída/arquivada depois?
- Como o sistema trata uma tentativa de login malsucedida repetida (força bruta) ou uma sessão expirada no meio de um cadastro?
- O que acontece quando a imagem anexada a uma transação excede um tamanho razoável de arquivo ou está em formato não suportado?
- Como o sistema lida com valores de transação ou de ativos incoerentes (ex.: quantidade negativa, preço zero ou data futura)?

## Requirements *(mandatory)*

### Functional Requirements

**Acesso e conta do usuário**
- **FR-001**: O sistema DEVE exigir autenticação (login) para acessar qualquer módulo ou dado financeiro.
- **FR-002**: O sistema DEVE isolar completamente os dados de cada pessoa usuária, de forma que ninguém tenha acesso aos dados financeiros de outra pessoa.
- **FR-003**: O sistema DEVE encerrar a sessão da pessoa usuária após um período de inatividade e permitir logout manual a qualquer momento.

**Módulo Contas**
- **FR-010**: O sistema DEVE permitir que a pessoa usuária crie uma conta financeira informando nome e tipo (corrente ou investimento).
- **FR-011**: O sistema DEVE permitir editar o nome e arquivar/inativar uma conta existente.
- **FR-012**: O sistema DEVE impedir a exclusão definitiva de uma conta que possua transações ou ativos vinculados, oferecendo arquivamento como alternativa.
- **FR-013**: O sistema DEVE exibir, para cada conta, um saldo ou valor consolidado calculado a partir de suas transações e/ou ativos.

**Módulo Transacional**
- **FR-020**: O sistema DEVE permitir o cadastro manual de uma transação com, no mínimo, valor, data, tipo (entrada/saída), categoria, conta associada e descrição opcional.
- **FR-021**: O sistema DEVE permitir editar e excluir transações já cadastradas, recalculando os totais afetados.
- **FR-022**: O sistema DEVE permitir filtrar e listar transações por conta, período e categoria.
- **FR-023**: O sistema DEVE permitir anexar uma imagem (ex.: foto de nota fiscal ou comprovante) a uma transação, armazenando-a para viabilizar leitura automática (OCR) em uma fase futura; nesta fase, os campos da transação continuam sendo preenchidos manualmente.
- **FR-024**: O sistema DEVE validar que valores de transação são numéricos e maiores que zero, e que a data não é inválida.

**Módulo Asset Manager**
- **FR-030**: O sistema DEVE permitir o cadastro de um ativo de investimento (ex.: ação, fundo imobiliário) associado a uma conta do tipo investimento, com quantidade e preço pago na aquisição.
- **FR-031**: O sistema DEVE obter a cotação de mercado atualizada de cada ativo cadastrado a partir de uma fonte externa de dados de mercado.
- **FR-032**: O sistema DEVE calcular e exibir, por ativo e de forma consolidada por carteira: valor total pago, valor de mercado atual e rentabilidade (absoluta e percentual).
- **FR-033**: O sistema DEVE permitir registrar o recebimento de proventos (dividendos/rendimentos) associados a um ativo, incorporando-os ao cálculo de rentabilidade.
- **FR-034**: O sistema DEVE permitir registrar a venda/encerramento de uma posição, calculando o resultado realizado e preservando o histórico da posição.
- **FR-035**: O sistema DEVE exibir o último valor de cotação conhecido, sinalizado como desatualizado, quando a fonte externa de cotações estiver indisponível.

**Módulo Dashboard**
- **FR-040**: O sistema DEVE apresentar, por padrão, um layout inicial com visões essenciais (saldo consolidado, gastos por categoria, evolução patrimonial) sem exigir qualquer configuração da pessoa usuária.
- **FR-041**: O sistema DEVE permitir que a pessoa usuária adicione, remova, redimensione e reposicione livremente blocos de visualização no dashboard.
- **FR-042**: O sistema DEVE permitir que a pessoa usuária escolha, para cada bloco, a fonte de dados (contas, transações e/ou ativos específicos) e o tipo de visualização (ex.: gráfico de linha, barra, pizza, indicador numérico, tabela).
- **FR-043**: O sistema DEVE persistir as personalizações de layout feitas pela pessoa usuária, mantendo-as entre sessões.
- **FR-044**: O sistema DEVE permitir restaurar o dashboard ao layout padrão a qualquer momento, sem afetar os dados subjacentes.

### Key Entities

- **Usuário**: pessoa que acessa o sistema; possui credenciais de login e é dona exclusiva de todos os dados que cadastra.
- **Conta**: representa uma conta financeira real (corrente ou investimento) da pessoa usuária; agrupa transações e/ou ativos.
- **Transação**: um lançamento financeiro do dia a dia (entrada ou saída) associado a uma conta, com valor, data, categoria, descrição e, opcionalmente, uma imagem de comprovante anexada.
- **Ativo de Investimento**: uma posição de investimento (ex.: ação, FII) associada a uma conta de investimento, com histórico de aquisições, proventos recebidos e eventuais vendas.
- **Cotação de Mercado**: valor de mercado mais recente conhecido de um ativo, obtido de uma fonte externa, usado para calcular valor atual e rentabilidade.
- **Bloco de Dashboard**: um elemento visual configurável (gráfico, indicador, tabela) que a pessoa usuária adiciona ao seu painel, referenciando uma fonte de dados e um tipo de visualização.
- **Layout de Dashboard**: a composição e organização (posição, tamanho, blocos presentes) de um dashboard, seja o padrão do sistema ou uma versão personalizada por pessoa usuária.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma pessoa usuária nova consegue cadastrar sua primeira conta e lançar sua primeira transação em menos de 3 minutos, sem precisar de ajuda ou explicação externa.
- **SC-002**: Uma pessoa usuária consegue montar um bloco de dashboard personalizado (escolher fonte de dados e visualização) em menos de 1 minuto, sem qualquer conhecimento técnico.
- **SC-003**: 90% das pessoas usuárias que testam o dashboard personalizável, em pesquisa de satisfação, descrevem a experiência como diferenciada/agradável em comparação a planilhas ou apps financeiros tradicionais.
- **SC-004**: A rentabilidade de uma carteira de investimentos exibida reflete a cotação de mercado mais recente disponível em até 15 minutos de atraso em relação ao mercado, ou indica claramente quando o dado está desatualizado.
- **SC-005**: Zero incidentes de vazamento de dados financeiros entre pessoas usuárias diferentes, verificado por testes de isolamento de dados.
- **SC-006**: Uma pessoa usuária consegue localizar e revisar todas as transações de uma conta em um determinado mês em menos de 30 segundos usando os filtros disponíveis.

## Assumptions

- O sistema é de uso pessoal (uma pessoa usuária vê e gerencia apenas os próprios dados); não há neste momento conceito de conta compartilhada/familiar com múltiplos acessos a um mesmo conjunto de dados.
- A moeda de referência é o Real (BRL) e os ativos de investimento cobertos são os negociados no mercado brasileiro (ex.: ações e fundos imobiliários listados na B3), compatível com a fonte de cotações de mercado que será usada.
- Nesta fase, o upload de imagem em transações apenas armazena o arquivo anexado para uso futuro; a leitura automática (OCR) que preencheria os campos automaticamente é uma capacidade futura e está fora do escopo desta entrega.
- A fonte externa de cotações de mercado está sujeita a limites de uso (plano gratuito), portanto a atualização de preços pode não ser em tempo real estrito; um pequeno atraso (minutos) é aceitável e deve ser comunicado à pessoa usuária quando relevante.
- O layout padrão do dashboard é definido pelo sistema como ponto de partida; qualquer pessoa usuária nova recebe esse padrão até personalizá-lo.
- Autenticação usa um mecanismo de login padrão (usuário/senha ou equivalente) com sessão protegida; não há exigência explícita de múltiplos métodos de autenticação (ex.: redes sociais, biometria) para esta entrega.
- A interface visual deve ser autoral e diferenciada (não seguindo padrões genéricos de dashboards financeiros "prontos"), mas essa direção de estilo será detalhada na fase de planejamento/design, não nesta especificação de requisitos.
