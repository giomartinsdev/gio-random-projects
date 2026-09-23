package postgres

import (
	"testing"

	domainclubs "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/clubs"
)

// O ref() é o que o ranking e o top_clubs usam para descrever um clube. Estes
// campos não são cosméticos: o escudo é desenhado a partir do asset id e das
// quatro cores, então um ref que os descarta faz o MESMO clube aparecer com
// dois escudos diferentes -- um na lista, outro no perfil, onde o clube vem
// inteiro. Teste puro (sem Postgres) porque a falha é de contrato, não de
// query: se um campo novo entrar no desenho, ele tem que entrar aqui também.
func TestRefCarriesTheFieldsTheCrestNeeds(t *testing.T) {
	in := domainclubs.Club{
		ClubID:        "7340",
		Name:          "Dont Mata FC",
		Tag:           "DMT",
		EscudoAssetID: "99160522",
		Color1:        15921906,
		Color2:        5775459,
		Color3:        5775459,
		Color4:        5775459,
	}

	got := ref(in)

	if got.CrestAssetID != in.EscudoAssetID {
		t.Errorf("CrestAssetID = %q; want %q", got.CrestAssetID, in.EscudoAssetID)
	}
	if got.Color1 != in.Color1 || got.Color2 != in.Color2 || got.Color3 != in.Color3 || got.Color4 != in.Color4 {
		t.Errorf("cores = (%d,%d,%d,%d); want (%d,%d,%d,%d)",
			got.Color1, got.Color2, got.Color3, got.Color4,
			in.Color1, in.Color2, in.Color3, in.Color4)
	}
}
