package httpapi

import (
	_ "embed"
	"net/http"
)

//go:embed openapi.yaml
var openAPISpec []byte

//go:embed docs.html
var docsHTML []byte

// ServeOpenAPISpec and ServeDocs are public — no API key, no rate
// limit. They're documentation, not data; gating them would just make
// the docs unreachable for anyone deciding whether to request a key.
func ServeOpenAPISpec(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/yaml")
	_, _ = w.Write(openAPISpec)
}

func ServeDocs(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html")
	_, _ = w.Write(docsHTML)
}
