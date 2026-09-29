package httpapi

import (
	"bytes"
	"image/png"
	"os"
	"testing"
)

// O gerador de cartão precisa produzir um PNG válido e não-trivial. A checagem
// é de INTENÇÃO, não pixel a pixel: um PNG que decodifica, com as dimensões
// certas e de tamanho não-desprezível (ou seja, com conteúdo desenhado). Um
// bug que deixasse a imagem em branco passaria por "decodificou", por isso o
// piso de bytes.
func TestDrawCardGeraPNGValido(t *testing.T) {
	data, err := drawCard("Vila Nova FC", "VNF", 1, 50, 30, 5, 15)
	if err != nil {
		t.Fatalf("drawCard: %v", err)
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("o resultado não é PNG válido: %v", err)
	}
	if img.Bounds().Dx() != cardW || img.Bounds().Dy() != cardH {
		t.Errorf("dimensões = %dx%d; want %dx%d", img.Bounds().Dx(), img.Bounds().Dy(), cardW, cardH)
	}
	if len(data) < 3000 {
		t.Errorf("PNG com %d bytes -- provavelmente em branco (fundo só)", len(data))
	}
}

// O nome do clube deriva o escudo: o MESMO clube tem que dar a mesma cor, e
// clubes diferentes, cores diferentes. Sem isso o cartão mentiria sobre a
// identidade visual que a tela mostra.
func TestClubColorsEEstavelEPorClube(t *testing.T) {
	b1, d1 := clubColors("Vila Nova FCVNF")
	b2, d2 := clubColors("Vila Nova FCVNF")
	if b1 != b2 || d1 != d2 {
		t.Error("mesma seed precisa dar a mesma paleta")
	}
	b3, _ := clubColors("Atlético CentralATC")
	if b1 == b3 {
		t.Error("clubes diferentes deveriam ter paletas diferentes")
	}
}

// Nome com acento não pode quebrar o desenho (a fonte embutida cobre o
// essencial; o que se garante aqui é que não estoura).
func TestDrawCardComAcentoNaoQuebra(t *testing.T) {
	if _, err := drawCard("Atlético Central", "ATC", 2, 10, 5, 2, 3); err != nil {
		t.Fatalf("nome com acento quebrou: %v", err)
	}
}

// Gera um PNG em disco quando GALLERY=1: é assim que se inspeciona o cartão a
// olho durante o desenvolvimento, sem depender de subir o serviço.
func TestDrawCardGaleria(t *testing.T) {
	if os.Getenv("GALLERY") != "1" {
		t.Skip("defina GALLERY=1 para escrever o PNG de inspeção")
	}
	data, err := drawCard("Vila Nova FC", "VNF", 1, 50, 30, 5, 15)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile("/tmp/card.png", data, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Log("escrito em /tmp/card.png")
}
