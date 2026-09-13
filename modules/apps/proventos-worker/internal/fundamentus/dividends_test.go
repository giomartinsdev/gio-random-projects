package fundamentus

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestFetchDividends_ParsesRealFixture(t *testing.T) {
	fixture, err := os.ReadFile("testdata/petr4.html")
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(fixture)
	}))
	defer srv.Close()

	original := baseURL
	baseURL = srv.URL
	defer func() { baseURL = original }()

	c := New()
	c.http = srv.Client()
	dividends, err := c.FetchDividends(context.Background(), "PETR4")
	if err != nil {
		t.Fatalf("FetchDividends: %v", err)
	}
	if len(dividends) == 0 {
		t.Fatal("expected at least one dividend parsed from the fixture")
	}

	first := dividends[0]
	wantData := time.Date(2026, time.November, 23, 0, 0, 0, 0, time.UTC)
	if !first.DataPagamento.Equal(wantData) {
		t.Errorf("DataPagamento = %v, want %v", first.DataPagamento, wantData)
	}
	if first.ValorPorAcao != 0.6741 {
		t.Errorf("ValorPorAcao = %v, want 0.6741", first.ValorPorAcao)
	}
	if first.Tipo != "JRS CAP PROPRIO" {
		t.Errorf("Tipo = %q, want %q", first.Tipo, "JRS CAP PROPRIO")
	}
}

func TestParseValorBR(t *testing.T) {
	cases := map[string]float64{
		"0,4716":   0.4716,
		"1.234,56": 1234.56,
		"  0,01  ": 0.01,
	}
	for in, want := range cases {
		got, err := parseValorBR(in)
		if err != nil {
			t.Errorf("parseValorBR(%q): %v", in, err)
			continue
		}
		if got != want {
			t.Errorf("parseValorBR(%q) = %v, want %v", in, got, want)
		}
	}
}
