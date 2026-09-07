package decks

// Internet: a vida online que a gente finge que não vive. Stalk de
// madrugada, grupo de vizinhos em guerra, assinatura esquecida. O alvo
// é sempre a situação -- nada de pessoas reais ou grupos específicos.
func init() {
	Register(Deck{
		ID:          "internet",
		Name:        "Internet",
		Emoji:       "📱",
		Description: "Stalk de madrugada, grupo de vizinhos em guerra, assinatura esquecida.",
		whites: []string{
			"O thread de 47 partes que ninguém leu",
			"O influencer vendendo curso de milionário",
			"Meu perfil falso de fã de banda",
			"O meme de 2019 que eu ainda mando hoje",
			"A stalk de quatro da manhã no perfil do ex",
			"O print da conversa que acabou com uma amizade",
			"A legenda profunda com foto do céu",
			"O filtro de beleza que convenceu até minha mãe",
			"O grupo de vizinhos brigando por causa de cachorro",
			"O story indireto que todo mundo sabe para quem é",
			"O algoritmo que só me mostra conspiração",
			"A conta fake dando opinião sobre ela mesma",
			"O vídeo de vinte minutos explicando uma receita de ovo",
			"O comentário de bot oferecendo criptomoeda em inglês",
			"A assinatura mensal que esqueci de cancelar",
			"O perfil profissional com foto de formatura de 2015",
			"O grupo 'amigos 🍻' sem mensagem há três anos",
			"A senha reutilizada em tudo desde 2010",
			"O podcast de duas horas sobre nada",
			"O termo de uso que aceitei sem ler",
			"A denúncia anônima por foto antiga",
			"O tweet apagado às 3h47",
			"A live que virou humilhação nacional",
			"O youtuber testando remédio caseiro no público",
			"O vídeo caseiro que virou material de aula de direito",
			"O story de academia no primeiro dia de janeiro",
			"__",
			"__",
		},
		blacks: []string{
			"O que vazou do meu grupo mais secreto? _.",
			"Meu algoritmo está convencido de que eu preciso de _.",
			"A vida do brasileiro hoje se resume a _.",
			"O que acabou de arruinar a internet? _.",
			"Descobrir _ às 3 da manhã mudou a minha vida.",
			"O motivo do meu bloqueio foi _.",
			"Meu último post viral era sobre _ e _.",
			"O que está por trás da conta fake da minha tia? _.",
		},
	})
}