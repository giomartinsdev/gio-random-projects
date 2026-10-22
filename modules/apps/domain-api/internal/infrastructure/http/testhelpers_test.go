package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// getJSON dispara um GET no router de teste e devolve o recorder.
//
// Nasceu em clubshandlers_test.go (clubs) e era usado pelos testes do
// financeiro; ficou aqui quando aquele arquivo saiu, para o helper não
// depender de um agregado que não existe mais.
func getJSON(t *testing.T, handler http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}
