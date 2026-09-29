package httpapi

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// O rate limiter é o que impede um clique repetido de virar rajada contra o CDN
// da fonte -- o que bloquearia por IP e derrubaria a coleta de todos. A lógica é
// pura e testável: nada aqui depende de HTTP.
func TestSyncLimiterPermiteDepoisDaJanela(t *testing.T) {
	l := newSyncLimiter()
	base := time.Now()

	if ok, _ := l.allow("a@x.com", base); !ok {
		t.Fatal("a primeira tentativa é sempre permitida")
	}
	// Dentro da janela de 30 min: negado, e diz quanto falta.
	ok, falta := l.allow("a@x.com", base.Add(10*time.Minute))
	if ok {
		t.Fatal("dentro de 30 min deveria negar")
	}
	if falta < 19*time.Minute || falta > 20*time.Minute {
		t.Errorf("falta = %v; want ~20min", falta)
	}
	// Depois da janela: permitido de novo.
	if ok, _ := l.allow("a@x.com", base.Add(31*time.Minute)); !ok {
		t.Fatal("depois de 30 min deveria permitir")
	}
}

// O limite é POR PESSOA: a repetição de uma não pode travar as outras.
func TestSyncLimiterEhPorPessoa(t *testing.T) {
	l := newSyncLimiter()
	base := time.Now()
	l.allow("a@x.com", base)

	if ok, _ := l.allow("b@x.com", base); !ok {
		t.Fatal("outra pessoa não deve ser afetada pelo cooldown de a")
	}
}

// peek não registra tentativa: só conta quanto falta. É o que a tela lê para
// desabilitar o botão sem consumir a janela.
func TestSyncLimiterPeekNaoConsome(t *testing.T) {
	l := newSyncLimiter()
	base := time.Now()

	if d := l.peek("a@x.com", base); d != 0 {
		t.Errorf("peek sem histórico = %v; want 0", d)
	}
	l.allow("a@x.com", base)
	if d := l.peek("a@x.com", base.Add(10*time.Minute)); d < 19*time.Minute {
		t.Errorf("peek = %v; want ~20min", d)
	}
	// peek não registrou nada: pedir continua permitido.
	if ok, _ := l.allow("a@x.com", base.Add(10*time.Minute+time.Second)); ok {
		t.Fatal("10min depois ainda está no cooldown")
	}
}

// A rota responde 429 com o tempo de espera quando o cooldown está ativo. É o
// comportamento que a pessoa vê.
func TestStartSyncResponde429NoCooldown(t *testing.T) {
	s := NewServer(nil, Config{}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	h := s.Handler()

	req := func() int {
		r := httptest.NewRequest(http.MethodPost, "/api/sync", nil)
		r = r.WithContext(WithIdentity(r.Context(), Identity{Email: "a@x.com"}))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)
		return rec.Code
	}

	// A primeira passa (sem persistência, o proxy devolve vazio mas não erra).
	if code := req(); code == http.StatusTooManyRequests {
		t.Fatal("a primeira tentativa não pode ser 429")
	}
	// A segunda, imediata, bate no cooldown.
	if code := req(); code != http.StatusTooManyRequests {
		t.Fatalf("segunda tentativa = %d; want 429", code)
	}
}
