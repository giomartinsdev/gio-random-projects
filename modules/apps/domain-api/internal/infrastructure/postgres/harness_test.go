package postgres

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
)

// Harness de Postgres REAL via testcontainers para os testes de leitura do
// domain-api.
//
// Particularidade deste serviço: o domain-api NÃO é dono das tabelas de clubs --
// quem as cria e escreve é o domain-worker. Então o schema aplicado aqui vem do
// módulo do worker (`../domain-worker/internal/infrastructure/postgres/schema.sql`),
// e não de uma cópia. Duplicar o DDL criaria duas verdades: a tabela do teste
// poderia divergir da de produção sem ninguém perceber, e o teste passaria
// testando um schema que não existe.
//
// Um container por PROCESSO (TestMain). Sem Docker, os testes que precisam de
// banco se pulam; o resto da suíte (testes puros de contrato) segue rodando.

var readDSN string

func TestMain(m *testing.M) {
	os.Exit(runWithPostgres(m))
}

func runWithPostgres(m *testing.M) int {
	ctx := context.Background()
	schemaPath, err := workerSchemaPath()
	if err != nil {
		fmt.Fprintf(os.Stderr, "schema do worker não encontrado: %v\n", err)
		return m.Run()
	}

	pg, err := tcpostgres.Run(ctx, "postgres:16-alpine",
		tcpostgres.WithDatabase("teste"),
		tcpostgres.WithUsername("teste"),
		tcpostgres.WithPassword("teste"),
		tcpostgres.WithInitScripts(schemaPath),
		tcpostgres.BasicWaitStrategies(),
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "testcontainers indisponível (%v); leitura com banco pulada\n", err)
		return m.Run()
	}
	defer func() { _ = pg.Terminate(ctx) }()

	dsn, err := pg.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		fmt.Fprintf(os.Stderr, "connection string: %v\n", err)
		return 1
	}
	readDSN = dsn
	return m.Run()
}

// workerSchemaPath sobe a árvore até a raiz do repo e aponta para o schema.sql
// do domain-worker -- a fonte única das tabelas de clubs.
func workerSchemaPath() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		candidate := filepath.Join(dir, "apps", "domain-worker", "internal", "infrastructure", "postgres", "schema.sql")
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("schema.sql do domain-worker não encontrado a partir de %s", dir)
		}
		dir = parent
	}
}

func readPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	if readDSN == "" {
		t.Skip("Docker indisponível; pulando teste de leitura com banco")
	}
	pool, err := pgxpool.New(context.Background(), readDSN)
	if err != nil {
		t.Fatalf("conectar: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// seedSnapshots insere leituras datadas para um clube e limpa no fim.
func seedSnapshots(t *testing.T, pool *pgxpool.Pool, clubID string, rows []snapshotRow) {
	t.Helper()
	ctx := context.Background()
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM clubs_snapshots WHERE club_id = $1`, clubID) })
	for _, r := range rows {
		// O id é gerado na aplicação (a tabela não tem default), então o teste
		// gera o mesmo UUID v4 que o repositório geraria.
		_, err := pool.Exec(ctx, `
			INSERT INTO clubs_snapshots
				(id, club_id, read_at, skill_rating, division_at_read, played, wins, draws, losses, goals, goals_conceded, squad_size)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
			uuid.NewString(), clubID, r.at, r.skill, r.division, r.played, r.wins, r.draws, r.losses, r.goals, r.conceded, 16)
		if err != nil {
			t.Fatalf("seed snapshot: %v", err)
		}
	}
}

type snapshotRow struct {
	at       time.Time
	skill    int
	division int
	played   int
	wins     int
	draws    int
	losses   int
	goals    int
	conceded int
}
