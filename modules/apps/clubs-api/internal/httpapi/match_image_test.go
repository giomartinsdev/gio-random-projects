package httpapi

import (
	"bytes"
	"image/png"
	"testing"
	"time"
)

// A súmula precisa produzir um PNG válido e não-trivial (placar e escudos
// desenhados). A checagem é de intenção: decodifica, tem as dimensões certas e
// não é um fundo em branco.
func TestDrawMatchCardGeraPNGValido(t *testing.T) {
	data, err := drawMatchCard(matchCard{
		HomeName: "Vila Nova FC", HomeTag: "VNV",
		AwayName: "Porto Rival", AwayTag: "PRT",
		HomeGoals: 3, AwayGoals: 1,
		Kind: "league", When: time.Now(),
		BestGamertag: "Craque", BestRating: 9.2, BestClub: "Vila Nova FC",
	})
	if err != nil {
		t.Fatalf("drawMatchCard: %v", err)
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("não é PNG válido: %v", err)
	}
	if img.Bounds().Dx() != matchCardW || img.Bounds().Dy() != matchCardH {
		t.Errorf("dimensões = %dx%d; want %dx%d", img.Bounds().Dx(), img.Bounds().Dy(), matchCardW, matchCardH)
	}
	if len(data) < 3000 {
		t.Errorf("PNG com %d bytes -- provavelmente em branco", len(data))
	}
}

// Súmula sem melhor em campo (partida sem jogadores) não pode quebrar.
func TestDrawMatchCardSemMelhorEmCampo(t *testing.T) {
	if _, err := drawMatchCard(matchCard{
		HomeName: "A", HomeTag: "A", AwayName: "B", AwayTag: "B",
		HomeGoals: 0, AwayGoals: 0, Kind: "friendly",
	}); err != nil {
		t.Fatalf("súmula sem jogadores quebrou: %v", err)
	}
}

// O endpoint responde PNG de verdade com o Content-Type certo.
func TestMatchImageRespondePNG(t *testing.T) {
	h := ogServer(t, map[string]string{
		"/matches/m1": `{"match_id":"m1","home_club_name":"Vila Nova FC","home_club_tag":"VNV","away_club_name":"Porto Rival","away_club_tag":"PRT","home_goals":3,"away_goals":1,"kind":"league","timestamp":"2026-09-20T15:00:00Z","players":[{"club_id":"1","gamertag":"Craque","rating":9.2}]}`,
	}, "https://clubs.giomartins.dev")

	rec := getHTML(t, h, "/og/match/m1/image.png")
	if rec.Code != 200 {
		t.Fatalf("status = %d; want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Fatalf("Content-Type = %q; want image/png", ct)
	}
}

// O HTML do preview da partida aponta para a imagem (o que faltava).
func TestOGMatchApontaParaAImagem(t *testing.T) {
	h := ogServer(t, map[string]string{
		"/matches/m1": `{"match_id":"m1","home_club_name":"A","away_club_name":"B","home_goals":1,"away_goals":0}`,
	}, "https://clubs.giomartins.dev")
	body := getHTML(t, h, "/og/match/m1").Body.String()
	if !contains(body, `content="https://clubs.giomartins.dev/og/match/m1/image.png"`) {
		t.Fatalf("og:image da partida ausente:\n%s", body)
	}
}

func contains(s, sub string) bool { return bytes.Contains([]byte(s), []byte(sub)) }
