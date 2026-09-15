package clips

import (
	"crypto/rand"
	"fmt"
)

// RandomID returns an unguessable clip id: 22 characters drawn from a
// 32-symbol alphabet is 110 bits of entropy -- a download URL is
// effectively a bearer credential, so it has to be as strong as a
// password. Rejection sampling, same as rooms.RandomID, because an
// alphabet that doesn't divide 256 skews under plain modulo.
func RandomID() (string, error) {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	out := make([]byte, 0, 22)
	buf := make([]byte, 1)
	limit := byte(256 - (256 % len(alphabet)))
	for len(out) < 22 {
		if _, err := rand.Read(buf); err != nil {
			return "", fmt.Errorf("random id: %w", err)
		}
		if buf[0] >= limit {
			continue
		}
		out = append(out, alphabet[int(buf[0])%len(alphabet)])
	}
	return string(out), nil
}
