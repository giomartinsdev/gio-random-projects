package decks

// Reunião de Família: o terror silencioso do domingo. Sogra, tio do
// zap, herança, peru seco. O peso aqui é o desconforto universal de
// quem tem parente -- o alvo é sempre a situação, nunca uma pessoa de
// verdade (mesmo contrato do pacote).
func init() {
	Register(Deck{
		ID:          "familia",
		Name:        "Reunião de Família",
		Emoji:       "👵",
		Description: "Sogra, tio do zap, herança e peru seco. O domingo que ninguém pediu.",
		whites: []string{
			"O tio que descobriu a economia no grupo do zap",
			"A tia que vende chá detox e agora vende criptomoeda",
			"O primo que virou coach de prosperidade",
			"A sobremesa com pedaço de vidro da vovó",
			"O churrasco em que minha contribuição foi elogiar",
			"A discussão sobre política que ninguém pediu",
			"O parente que pergunta quando chega o neto",
			"A foto do falecido vigiando a sala inteira",
			"O álbum de família com todas as minhas fotos tortas",
			"A receita de família que exige três dias de molho",
			"O natal às 3 da tarde com peru seco e ventilador quebrado",
			"O brinde com refrigerante morno em copo plástico",
			"A criança que descobriu o micro-ondas com garfo",
			"O jogo de cartas com aposta de mesada",
			"A tia que beija com batom e deixa marca em todo mundo",
			"O cunhado que só fala de criptomoeda",
			"A sogra reorganizando minha cozinha às 7h da manhã",
			"O parente distante que só aparece no inventário",
			"A árvore genealógica que para em 1900 por bom motivo",
			"O grupo da família com 47 encaminhados por dia",
			"A corrente de boa sorte que ameaça dez anos de azar",
			"O bolo de aniversário com a idade mentida",
			"A herança de um relógio parado",
			"O tio dormindo no sofá e roncando o sermão",
			"A criança que perguntou em voz alta por que o casal não tem filho",
			"O abraço apertado que quebra uma costela",
			"O quadro de horários do almoço de domingo",
			"O piquenique com formigas convidadas",
			"__",
			"__",
		},
		blacks: []string{
			"O que acabou com o almoço de domingo da família? _.",
			"No grupo da família, o assunto do dia é _.",
			"A vovó escondeu _ no fundo da gaveta das colheres.",
			"O que o tio revelou depois da terceira cerveja? _.",
			"Nada diz 'bem-vindo ao natal em família' como _.",
			"O motivo real da briga de 2017 foi _.",
			"A foto de família dos anos 90 esconde _.",
			"A herança da vovó se resumiu a _ e _.",
		},
	})
}