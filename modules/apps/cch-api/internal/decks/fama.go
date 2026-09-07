package decks

// Fama & Escândalo: o lado pesado da celebridade. Cancelamento, paparazzi,
// biografia não autorizada, holograma de defunto em turnê. Mesmo contrato do
// pacote: o alvo é sempre o papel ("o astro", "o empresário", "a diva") e a
// situação -- ninguém real citado pelo nome, o peso vem da queda, do vazamento
// e do fã que levou o fandom a sério demais.
func init() {
	Register(Deck{
		ID:          "fama",
		Name:        "Fama & Escândalo",
		Emoji:       "🌟",
		Description: "Astro em crise, cancelamento, paparazzi e o fã que foi longe demais. O glamour morre no tapete vermelho.",
		whites: []string{
			// --- Queda, Cancelamento & Escândalo ---
			"A celebridade cancelada abrindo pizzaria",
			"O documentário de seis partes sobre a queda do astro",
			"A biografia não autorizada vendida no semáforo",
			"O áudio de 4 minutos vazado do grupo do staff",
			"A entrevista chorosa agendada antes da crise existir",
			"O pedido de desculpas escrito pelo assessor",
			"O print de 2013 que derrubou a carreira inteira",
			"O canal de fofoca que desligou as luzes da fama",
			"O astro recontratado só pra pagar a dívida",
			"O prêmio devolvido por carta do advogado",
			"A festa de lançamento que acabou na delegacia",
			"O astro preso por sonegação em praça pública",
			"A calça rasgada no palco que virou marca registrada",

			// --- Máquina da Fama & Contrato ---
			"O empresário que levava 90% e chamava de gestão",
			"O contrato de 40 páginas com a cláusula do silêncio",
			"O ghost producer morando no porão do estúdio",
			"O hit plagiado do primo anônimo que desistiu do processo",
			"O astro falido vendendo curso de riqueza",
			"A cirurgia plástica que apagou o rosto do personagem",
			"O galã de novela com a calvície tatuada",
			"O dublê que fazia as cenas e nunca a fama",
			"A turnê com ingresso mais caro que o aluguel",
			"O show com 12 espectadores e produção de estádio",
			"O fã clube que virou seita com dízimo",

			// --- Morte da Celebridade & Pós-Vida ---
			"A turnê holográfica do defunto",
			"O astro que fez mais shows morto do que vivo",
			"O autógrafo vendido pela família depois do velório",
			"A capa da revista anunciando a morte por engano",
			"O velório do astro com ingresso catraca",
			"O fã que tatuou o rosto da celebridade errada",
			"O fã obsessivo acampando no portão há três anos",
			"O paparazzi deitado no capô do carro fugitivo",
			"O deepfake do galã vendendo criptomoeda",
			"O influencer fingindo luto por engajamento",
			"A live do desespero com três espectadores",
			"O reality show que descobriu o corpo no set",
			"O astro infantil que cresceu e virou case de internet",
			"__",
			"__",
		},
		blacks: []string{
			"A carreira do astro acabou quando vazou _.",
			"O que o paparazzi vendeu por sete dígitos? _.",
			"No testamento, o astro deixou tudo para _.",
			"O que o holograma do defunto cantou no show póstumo? _.",
			"O que o empresário escondeu no contrato de 40 páginas? _.",
			"O cancelamento da semana foi por causa de _.",
			"O que o fã obsessivo tatuou no rosto? _.",
			"O que a assessoria não conseguiu tapar dessa vez? _.",
		},
	})
}