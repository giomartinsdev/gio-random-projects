package decks

// Trampo: o inferno corporativo em cartas. RH, reunião, meta
// impossível, estagiário pagando os pecados do time. O alvo é sempre a
// empresa imaginária e a situação, nunca uma pessoa real.
func init() {
	Register(Deck{
		ID:          "trampo",
		Name:        "Trampo",
		Emoji:       "💼",
		Description: "Reunião que podia ser e-mail, RH contra você, meta impossível. CLT raiz.",
		whites: []string{
			"A reunião que podia ser um e-mail",
			"O estagiário que resolveu o sistema em dez minutos",
			"O banco de horas que só existe num sentido",
			"O café estragado da máquina do escritório",
			"O feedback 'você precisa ser mais proativo'",
			"O crachá com foto de quando eu ainda era feliz",
			"A planilha sagrada que ninguém pode mexer",
			"O print do grupo do trabalho mandado no lugar errado",
			"O 'vamos falar disso off' no meio da reunião",
			"O RH defendendo a empresa contra mim",
			"O home office com pijama de reunião importante",
			"O e-mail 'urgente' enviado às 18h59 de sexta",
			"O curso de liderança ministrado por quem nunca liderou",
			"O salário de estágio com responsabilidade de gerente",
			"A planilha de férias negadas",
			"O 'time que vence junto' com um só vencedor",
			"O happy hour financiado pelo cartão corporativo",
			"O slide 47 da apresentação que ninguém leu",
			"O cartão de ponto que nunca conta direito",
			"O computador com a senha do estagiário de 2019",
			"A avaliação de desempenho escrita por IA",
			"O 'você é da família' seguido do corte do benefício",
			"A meta impossível com bônus de um chaveiro",
			"A despedida com bolo de supermercado e discurso falso",
			"O convite de link no LinkedIn com elogio falso",
			"A cadeira de escritório que rangia até a demissão",
			"__",
			"__",
		},
		blacks: []string{
			"O que estragou a minha carreira para sempre? _.",
			"No meio da reunião mais importante da minha vida, apareceu _.",
			"O funcionário do mês foi demitido por _.",
			"Para economizar, a empresa decidiu substituir _ por _.",
			"O que o RH encontrou no meu computador corporativo? _.",
			"Meu maior feito profissional até hoje: _.",
			"A reunião de segunda às 8h tinha um único assunto: _.",
			"No trabalho, 'seja você mesmo' significa _.",
		},
	})
}