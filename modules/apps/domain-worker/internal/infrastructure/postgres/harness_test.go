package postgres

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
)

// Harness de Postgres REAL via testcontainers.
//
// Por que existe: os testes de integração deste pacote antes só rodavam com
// TEST_DATABASE_URL setada, e se pulavam em silêncio quando não estava -- o que
// significa que NÃO rodavam no CI nem na máquina de quem não tinha um Postgres
// de pé. Um teste que se pula sozinho é um teste que não existe.
//
// Com testcontainers, o próprio teste sobe o Postgres, aplica o schema (o mesmo
// schema.sql do worker, dono das tabelas) e derruba no fim. Roda em qualquer
// lugar com Docker. TEST_DATABASE_URL continua funcionando: se estiver setada, o
// harness a usa em vez de subir container -- útil para apontar a um banco já
// quente durante desenvolvimento.
//
// Um container por PROCESSO (TestMain), não por teste: subir Postgres custa
// ~2s, e o isolamento que importa é por linha/tabela, não por processo. Cada
// teste limpa o que cria.

var harnessDSN string

func TestMain(m *testing.M) {
	os.Exit(runWithPostgres(m))
}

func runWithPostgres(m *testing.M) int {
	// Respeita TEST_DATABASE_URL quando já há um banco apontado: é o caminho de
	// quem quer rodar contra um Postgres quente, sem o custo do container.
	if dsn := os.Getenv("TEST_DATABASE_URL"); dsn != "" {
		harnessDSN = dsn
		return m.Run()
	}

	ctx := context.Background()
	// postgres:16 com o schema real do worker. O script de init só aplica o
	// schema; a limpeza entre testes é responsabilidade de cada teste (mesmo
	// modelo dos testes existentes), para não recriar o banco a cada caso.
	pg, err := tcpostgres.Run(ctx, "postgres:16-alpine",
		tcpostgres.WithDatabase("teste"),
		tcpostgres.WithUsername("teste"),
		tcpostgres.WithPassword("teste"),
		tcpostgres.WithInitScripts(initScriptPath()),
		tcpostgres.BasicWaitStrategies(),
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "testcontainers indisponível (%v); integração pulada\n", err)
		return m.Run()
	}
	defer func() { _ = pg.Terminate(ctx) }()

	dsn, err := pg.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		fmt.Fprintf(os.Stderr, "connection string: %v\n", err)
		return 1
	}
	harnessDSN = dsn
	return m.Run()
}

// initScriptPath aponta para o schema.sql do worker -- a fonte única das
// tabelas. Um banco de teste que monta um schema PARECIDO testa um sistema
// parecido; usar o mesmo arquivo é o que faz o teste valer.
func initScriptPath() string {
	// cwd do teste é o diretório do pacote (internal/infrastructure/postgres).
	abs, err := filepath.Abs("schema.sql")
	if err != nil {
		return "schema.sql"
	}
	return abs
}

// testPool devolve um pool ligado ao Postgres do harness, pulando o teste quando
// não há Docker. Todo teste de integração começa por aqui.
func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	if harnessDSN == "" {
		t.Skip("Docker indisponível; pulando teste de integração")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, harnessDSN)
	if err != nil {
		t.Fatalf("conectar: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := Migrate(ctx, pool); err != nil {
		t.Fatalf("aplicar schema: %v", err)
	}
	return pool
}

// waitFor é um helper para condições que dependem do banco (ex.: uma escrita
// que outro processo faria); falha o teste se estourar o tempo.
func waitFor(t *testing.T, d time.Duration, cond func() bool, msg string) {
	t.Helper()
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal(msg)
}
