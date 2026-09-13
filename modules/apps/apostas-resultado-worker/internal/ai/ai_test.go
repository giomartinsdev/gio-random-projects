package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func fakeChatServer(t *testing.T, content string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if streamed, _ := body["stream"].(bool); streamed {
			t.Fatalf("esperava stream:false explícito na requisição")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{"message": map[string]any{"content": content}},
			},
		})
	}))
}

func TestExtrairEventoConfiancaAlta(t *testing.T) {
	srv := fakeChatServer(t, `{"esporte":"futebol","participanteA":"Real Madrid","participanteB":"Barcelona","mercado":"vencedor","linha":0,"confianca":"alta"}`)
	defer srv.Close()

	c := New(srv.URL, "", "modelo-teste")
	evento, err := c.ExtrairEvento(context.Background(), "Real Madrid vence", time.Now())
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if evento.ParticipanteA != "Real Madrid" || evento.Confianca != "alta" {
		t.Fatalf("evento extraído errado: %+v", evento)
	}
}

func TestExtrairEventoToleraProsaAoRedor(t *testing.T) {
	srv := fakeChatServer(t, "Aqui está o JSON:\n```json\n{\"esporte\":\"futebol\",\"participanteA\":\"A\",\"participanteB\":\"B\",\"mercado\":\"outro\",\"linha\":0,\"confianca\":\"baixa\"}\n```")
	defer srv.Close()

	c := New(srv.URL, "", "modelo-teste")
	evento, err := c.ExtrairEvento(context.Background(), "descrição vaga", time.Now())
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if evento.Confianca != "baixa" {
		t.Fatalf("esperava confianca baixa, veio: %+v", evento)
	}
}

func TestDecidirResultado(t *testing.T) {
	srv := fakeChatServer(t, `{"resultado":"green","confianca":"alta"}`)
	defer srv.Close()

	c := New(srv.URL, "", "modelo-teste")
	resultado, err := c.DecidirResultado(context.Background(), Evento{ParticipanteA: "A", ParticipanteB: "B", Mercado: "vencedor"}, 2, 1)
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if resultado.Resultado != "green" || resultado.Confianca != "alta" {
		t.Fatalf("resultado errado: %+v", resultado)
	}
}

func TestClienteDesabilitadoSemModelo(t *testing.T) {
	if New("http://example.com", "chave", "") != nil {
		t.Fatal("esperava cliente nil sem modelo configurado")
	}
	if New("", "chave", "modelo") != nil {
		t.Fatal("esperava cliente nil sem base URL")
	}
}
