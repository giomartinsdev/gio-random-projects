// Package secret cifra o token do canal antes de gravar no banco.
//
// Um token de WhatsApp em claro num dump é acesso total à conta do cliente: dá
// para mandar mensagem para qualquer pessoa em nome dele. Cifrado com AES-GCM,
// sem a chave o dump não serve para nada.
//
// A chave vem de CHANNEL_SECRET. Sem ela o processo recusa ativar canal em live
// — gravar em claro "para funcionar" seria justamente o pior dos mundos.
package secret

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
)

// ErrNoKey é "não há chave configurada". Vira 422 com instrução, não 500.
var ErrNoKey = errors.New("CHANNEL_SECRET não configurado: sem ele não há como guardar o token com segurança")

// Box cifra e decifra com a mesma chave.
type Box struct {
	aead cipher.AEAD
}

// New deriva a chave do segredo com SHA-256. Derivação aqui é aceitável porque
// o segredo é uma string longa aleatória, não uma senha escolhida por pessoa —
// e assim uma variável de ambiente basta, sem arquivo de chave separado.
func New(secret string) (*Box, error) {
	if len(secret) < 16 {
		return nil, fmt.Errorf("CHANNEL_SECRET precisa de pelo menos 16 caracteres")
	}
	sum := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(sum[:])
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Box{aead: aead}, nil
}

// Seal devolve nonce||ciphertext em base64 — um único campo de texto no banco.
func (b *Box) Seal(plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := b.aead.Seal(nonce, nonce, []byte(plain), nil)
	return base64.RawStdEncoding.EncodeToString(sealed), nil
}

// Open desfaz Seal. Erro aqui significa chave trocada ou dado corrompido: o
// canal precisa ser reativado, e a mensagem de erro diz isso.
func (b *Box) Open(encoded string) (string, error) {
	if encoded == "" {
		return "", nil
	}
	raw, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	ns := b.aead.NonceSize()
	if len(raw) < ns {
		return "", fmt.Errorf("token cifrado inválido")
	}
	plain, err := b.aead.Open(nil, raw[:ns], raw[ns:], nil)
	if err != nil {
		return "", fmt.Errorf("não consegui decifrar o token do canal (CHANNEL_SECRET mudou?): reative o canal")
	}
	return string(plain), nil
}
