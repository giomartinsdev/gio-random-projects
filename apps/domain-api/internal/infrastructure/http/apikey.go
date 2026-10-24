package httpapi

import "strings"

// APIKeys holds the set of valid keys, parsed from
// DOMAIN_API_KEYS="key1:label1,key2:label2" — the label is only for
// logging/audit ("who made this request"), never checked.
type APIKeys map[string]string

func ParseAPIKeys(raw string) APIKeys {
	keys := APIKeys{}
	for _, entry := range strings.Split(raw, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		key, label, found := strings.Cut(entry, ":")
		if !found {
			label = "unlabeled"
		}
		keys[key] = label
	}
	return keys
}

// Label returns the caller's label and whether key was valid.
func (k APIKeys) Label(key string) (string, bool) {
	label, ok := k[key]
	return label, ok
}
