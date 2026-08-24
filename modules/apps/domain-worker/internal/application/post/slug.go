package post

import (
	"regexp"
	"strings"
)

var (
	nonAlnum   = regexp.MustCompile(`[^a-z0-9]+`)
	trimDashes = regexp.MustCompile(`^-+|-+$`)
)

// Slugify is a pure transform; unicode NFD/diacritic stripping stays
// simple (this repo's post titles are expected to be mostly
// Portuguese/English) rather than pulling in a full Unicode
// normalization dependency for it.
func Slugify(title string) string {
	s := strings.ToLower(title)
	replacer := strings.NewReplacer(
		"á", "a", "à", "a", "ã", "a", "â", "a",
		"é", "e", "ê", "e",
		"í", "i",
		"ó", "o", "ô", "o", "õ", "o",
		"ú", "u", "ü", "u",
		"ç", "c",
	)
	s = replacer.Replace(s)
	s = nonAlnum.ReplaceAllString(s, "-")
	return trimDashes.ReplaceAllString(s, "")
}
