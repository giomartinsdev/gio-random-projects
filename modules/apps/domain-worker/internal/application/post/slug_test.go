package post

import "testing"

func TestSlugify(t *testing.T) {
	cases := []struct {
		name  string
		title string
		want  string
	}{
		{"positive: simple title", "Como escalar Terraform sem chorar", "como-escalar-terraform-sem-chorar"},
		{"positive: accents get stripped", "Ação e reação", "acao-e-reacao"},
		{"edge: leading/trailing punctuation trimmed", "  --Olá, mundo!--  ", "ola-mundo"},
		{"edge: empty string", "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Slugify(c.title)
			if got != c.want {
				t.Errorf("Slugify(%q) = %q, want %q", c.title, got, c.want)
			}
		})
	}
}
