package steps

// Fixture do "par de domínio" falso via testcontainers.
//
// O fake (tests/fake-domain-pair/main.go) é copiado para dentro de um container
// golang:alpine e compilado com `go run`; o container fica no ar e a API sob
// teste fala com ele por HTTP de verdade. Sem Docker, a suíte é pulada -- um
// teste de integração que não pode rodar não deve passar em silêncio.

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

// startFakeDomainPair sobe o container, espera o /healthz e devolve a base URL
// mais um http.Client já pronto. A função stop derruba tudo (chamada via defer).
func startFakeDomainPair(t *testing.T, ctx context.Context) (string, *http.Client, func()) {
	t.Helper()

	src, err := filepath.Abs("../fake-domain-pair/main.go")
	if err != nil {
		t.Fatalf("caminho do fake: %v", err)
	}
	if _, err := os.Stat(src); err != nil {
		t.Fatalf("fake não encontrado em %s: %v", src, err)
	}

	req := testcontainers.ContainerRequest{
		Image:        "golang:1.25-alpine",
		ExposedPorts: []string{"8080/tcp"},
		Env:          map[string]string{"DOMAIN_KEY": domainKey},
		Files: []testcontainers.ContainerFile{
			{HostFilePath: src, ContainerFilePath: "/app/main.go", FileMode: 0o644},
		},
		// Compila e sobe dentro do container. O `go run` baixa só stdlib (já na
		// imagem), então não há rede nem módulo para resolver.
		Cmd: []string{"sh", "-c", "cd /app && go run main.go"},
		WaitingFor: wait.ForHTTP("/healthz").
			WithPort("8080/tcp").
			WithStartupTimeout(120 * time.Second).
			// O `go run` compila antes de escutar; a tolerância é para a
			// primeira compilação, mais lenta em CI.
			WithPollInterval(500 * time.Millisecond),
	}

	ctr, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: req,
		Started:          true,
	})
	if err != nil {
		t.Skipf("Docker/testcontainers indisponível; pulando integração: %v", err)
	}

	stop := func() {
		_ = ctr.Terminate(context.Background())
	}

	host, err := ctr.Host(ctx)
	if err != nil {
		stop()
		t.Fatalf("host do container: %v", err)
	}
	port, err := ctr.MappedPort(ctx, "8080/tcp")
	if err != nil {
		stop()
		t.Fatalf("porta mapeada: %v", err)
	}
	base := fmt.Sprintf("http://%s:%s", host, port.Port())
	return base, &http.Client{Timeout: 10 * time.Second}, stop
}
