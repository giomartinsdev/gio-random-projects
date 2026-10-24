package secret

import (
	"strings"
	"testing"
)

// O que precisa ser provado aqui não é "cifra e decifra": é que sem a chave o
// conteúdo não vaza, e que chave trocada falha em vez de devolver lixo.

func TestSealOpenRoundTrip(t *testing.T) {
	box, err := New("uma-chave-bem-comprida-para-teste")
	if err != nil {
		t.Fatal(err)
	}
	token := "EAAJBx0abcdefghijklmnop"
	sealed, err := box.Seal(token)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(sealed, token) {
		t.Fatal("o texto cifrado contém o token em claro")
	}
	got, err := box.Open(sealed)
	if err != nil {
		t.Fatal(err)
	}
	if got != token {
		t.Fatalf("veio %q", got)
	}
}

func TestSealIsRandomized(t *testing.T) {
	box, _ := New("uma-chave-bem-comprida-para-teste")
	a, _ := box.Seal("mesmo-token")
	b, _ := box.Seal("mesmo-token")
	if a == b {
		t.Fatal("dois selos do mesmo texto saíram iguais: nonce não está sendo usado")
	}
}

func TestOpenWithDifferentKeyFails(t *testing.T) {
	one, _ := New("chave-um-bem-comprida-aqui")
	other, _ := New("chave-dois-bem-comprida-aqui")
	sealed, _ := one.Seal("EAAJ-segredo")
	if _, err := other.Open(sealed); err == nil {
		t.Fatal("outra chave decifrou o token — o segredo não estaria protegendo nada")
	}
}

func TestShortSecretIsRefused(t *testing.T) {
	if _, err := New("curta"); err == nil {
		t.Fatal("aceitou segredo curto: uma chave fraca torna o AES-GCM decorativo")
	}
}

func TestEmptyStaysEmpty(t *testing.T) {
	box, _ := New("uma-chave-bem-comprida-para-teste")
	sealed, err := box.Seal("")
	if err != nil || sealed != "" {
		t.Fatalf("vazio deveria virar vazio, veio %q (%v)", sealed, err)
	}
	if got, _ := box.Open(""); got != "" {
		t.Fatalf("decifrar vazio deveria dar vazio, veio %q", got)
	}
}
