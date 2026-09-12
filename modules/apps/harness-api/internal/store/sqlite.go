// Package store is harness-api's persistence layer: a single SQLite
// file (modernc.org/sqlite, pure Go -- the docker image builds with
// CGO_ENABLED=0, so mattn/go-sqlite3 is not an option, research D2).
// Everything durable about a session lives here: the sessoes table, its
// append-only eventos timeline and the usuarios identity cache.
package store

import (
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	// Pure-Go SQLite driver; registers as "sqlite".
	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

type Store struct {
	db *sql.DB
}

// Open opens (creating if needed) the database at path, creating the
// parent directory first, and runs pending migrations. The file lives on
// a docker volume in production, so a plain path is all the
// configuration there is.
func Open(path string) (*Store, error) {
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("criar diretório do banco: %w", err)
		}
	}
	// PRAGMAs are per-connection in SQLite, so they ride on the DSN and
	// the driver applies them to every connection it opens:
	//   foreign_keys  -- the schema relies on FKs (origem_id, eventos cascade)
	//   busy_timeout  -- SQLite has a single writer; concurrent requests wait
	//                    instead of failing with SQLITE_BUSY
	//   journal_mode  -- WAL: readers never block the writer (or vice versa)
	dsn := "file:" + path + "?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("abrir sqlite: %w", err)
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrations: %w", err)
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

// migrate applies the embedded migrations in filename order, recording
// each one in schema_migrations so a restart only runs what is new.
func (s *Store) migrate() error {
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version     INTEGER PRIMARY KEY,
		aplicada_em INTEGER NOT NULL
	)`); err != nil {
		return fmt.Errorf("tabela de migrations: %w", err)
	}

	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		return err
	}
	for _, entry := range entries {
		version, err := migrationVersion(entry.Name())
		if err != nil {
			return err
		}
		var applied bool
		if err := s.db.QueryRow(
			`SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = ?)`, version,
		).Scan(&applied); err != nil {
			return err
		}
		if applied {
			continue
		}

		body, err := migrationsFS.ReadFile("migrations/" + entry.Name())
		if err != nil {
			return err
		}
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(string(body)); err != nil {
			tx.Rollback()
			return fmt.Errorf("%s: %w", entry.Name(), err)
		}
		if _, err := tx.Exec(
			`INSERT INTO schema_migrations (version, aplicada_em) VALUES (?, ?)`,
			version, time.Now().Unix(),
		); err != nil {
			tx.Rollback()
			return fmt.Errorf("registrar %s: %w", entry.Name(), err)
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

// migrationVersion reads the leading number of a migration filename
// ("001_init.sql" -> 1); the rest of the name is free-form description.
func migrationVersion(name string) (int64, error) {
	num, _, found := strings.Cut(name, "_")
	if !found {
		return 0, fmt.Errorf("migration %q fora do padrão <número>_<nome>.sql", name)
	}
	version, err := strconv.ParseInt(num, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("migration %q com número inválido: %w", name, err)
	}
	return version, nil
}

// UpsertUsuario is the D7 identity cache: called on every authenticated
// request, it stamps last visit and refreshes the display name (claims
// can change). Best effort from the middleware's point of view -- a
// failure here is logged, never blocks the request.
func (s *Store) UpsertUsuario(email, nome string) error {
	_, err := s.db.Exec(`INSERT INTO usuarios (email, nome, ultima_visita) VALUES (?, ?, ?)
		ON CONFLICT(email) DO UPDATE SET nome = excluded.nome, ultima_visita = excluded.ultima_visita`,
		email, nome, time.Now().Unix())
	if err != nil {
		return fmt.Errorf("upsert usuário %q: %w", email, err)
	}
	return nil
}

// Usuario is one cached identity: a display name for someone else's
// e-mail, as seen in timelines and lists.
type Usuario struct {
	Email        string
	Nome         string
	UltimaVisita int64
}

// UsuarioPorEmail reads one cached identity; ok is false when that
// e-mail was never seen by an authenticated request.
func (s *Store) UsuarioPorEmail(email string) (u Usuario, ok bool, err error) {
	err = s.db.QueryRow(
		`SELECT email, nome, ultima_visita FROM usuarios WHERE email = ?`, email,
	).Scan(&u.Email, &u.Nome, &u.UltimaVisita)
	if errors.Is(err, sql.ErrNoRows) {
		return Usuario{}, false, nil
	}
	if err != nil {
		return Usuario{}, false, fmt.Errorf("usuário %q: %w", email, err)
	}
	return u, true, nil
}
