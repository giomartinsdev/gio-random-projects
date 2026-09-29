package httpapi

import (
	"bytes"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"time"
)

// Súmula da partida em PNG: o placar, os dois escudos e o melhor em campo.
//
// Serve DOIS usos com o mesmo desenho: o og:image da partida (que faltava -- só
// clube e jogador tinham) e o botão "baixar súmula" na tela, para colar num
// Discord. Igual ao cartão de clube, é PNG porque bot de preview não renderiza
// SVG, e é desenhado aqui (não no browser) para o mesmo arquivo servir aos dois.

const (
	matchCardW = 1200
	matchCardH = 630
)

// matchPlayer é o mínimo que a súmula mostra de cada lado.
type matchPlayer struct {
	Gamertag string
	Rating   float64
	Goals    int
	Assists  int
}

// matchCard são os dados que a súmula desenha. Vem do payload da partida do
// domain-api.
type matchCard struct {
	HomeName, HomeTag    string
	AwayName, AwayTag    string
	HomeGoals, AwayGoals int
	Kind                 string
	PlayoffRound         string
	DecidedByForfeit     bool
	When                 time.Time
	// Melhor em campo (maior nota), de qualquer lado. Vazio se não há súmula.
	BestGamertag string
	BestRating   float64
	BestClub     string
}

// drawMatchCard compõe o PNG do placar.
func drawMatchCard(m matchCard) ([]byte, error) {
	img := image.NewRGBA(image.Rect(0, 0, matchCardW, matchCardH))
	draw.Draw(img, img.Bounds(), &image.Uniform{cardBg}, image.Point{}, draw.Src)

	homeBase, homeDetail := clubColors(m.HomeName + m.HomeTag)
	awayBase, awayDetail := clubColors(m.AwayName + m.AwayTag)

	// Escudos nos cantos do placar.
	shieldW, shieldH := 150, 175
	drawShield(img, 130, 150, shieldW, shieldH, homeBase, homeDetail, m.HomeTag)
	drawShield(img, matchCardW-130-shieldW, 150, shieldW, shieldH, awayBase, awayDetail, m.AwayTag)

	// O placar, no centro, grande.
	big, err := cardFont(150)
	if err != nil {
		return nil, err
	}
	mid, err := cardFont(38)
	if err != nil {
		return nil, err
	}
	small, err := cardFont(28)
	if err != nil {
		return nil, err
	}
	tiny, err := cardFont(22)
	if err != nil {
		return nil, err
	}

	// A cor do placar segue o resultado do mandante: verde vitória, vermelho
	// derrota, neutro empate -- a mesma leitura da tela.
	scoreColor := cardDrawCol
	switch {
	case m.HomeGoals > m.AwayGoals:
		scoreColor = cardWin
	case m.HomeGoals < m.AwayGoals:
		scoreColor = cardLossCol
	}
	score := fmt.Sprintf("%d – %d", m.HomeGoals, m.AwayGoals)
	drawCentered(img, big, scoreColor, matchCardW/2, 300, score)

	// Nomes e siglas sob os escudos.
	drawCentered(img, mid, cardFg, 130+shieldW/2, 380, truncate(m.HomeName, 18))
	drawCentered(img, small, cardMuted, 130+shieldW/2, 415, m.HomeTag)
	drawCentered(img, mid, cardFg, matchCardW-130-shieldW/2, 380, truncate(m.AwayName, 18))
	drawCentered(img, small, cardMuted, matchCardW-130-shieldW/2, 415, m.AwayTag)

	// Faixa de contexto: tipo de partida, rodada e data.
	contexto := kindLabel(m.Kind)
	if m.PlayoffRound != "" {
		contexto += " · " + m.PlayoffRound
	}
	if m.DecidedByForfeit {
		contexto += " · decidido por desistência"
	}
	if !m.When.IsZero() {
		contexto += " · " + m.When.UTC().Format("02/01/2006")
	}
	drawCentered(img, small, cardMuted, matchCardW/2, 490, contexto)

	// Melhor em campo, quando houver.
	if m.BestGamertag != "" {
		drawCentered(img, tiny, cardMuted, matchCardW/2, 545, "Melhor em campo")
		drawCentered(img, mid, cardAccent, matchCardW/2, 585,
			fmt.Sprintf("%s · %.1f", truncate(m.BestGamertag, 22), m.BestRating))
	}

	// A marca, no rodapé.
	drawCentered(img, tiny, cardMuted, matchCardW/2, matchCardH-24, "FC Clubs Hub · clubs.giomartins.dev")

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, fmt.Errorf("encode png da súmula: %w", err)
	}
	return buf.Bytes(), nil
}

// kindLabel é o rótulo do tipo de partida no cartão; o front traduz os dele,
// mas a imagem é um arquivo único (sem i18n), então o rótulo é fixo em pt.
func kindLabel(kind string) string {
	switch kind {
	case "league":
		return "Liga"
	case "friendly":
		return "Amistoso"
	case "playoff":
		return "Playoff"
	default:
		return "Partida"
	}
}
