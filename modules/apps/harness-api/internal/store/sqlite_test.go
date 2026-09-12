package store

import (
	"path/filepath"
	"testing"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "harness.db"))
	if err != nil {
		t.Fatalf("abrir store: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

// As 3 tabelas e os índices do data-model.md existem depois das
// migrations, e reabrir o MESMO arquivo não roda migration de novo nem
// falha (idempotência do bootstrap).
func TestOpenMigratesIdempotently(t *testing.T) {
	path := filepath.Join(t.TempDir(), "harness.db")

	s, err := Open(path)
	if err != nil {
		t.Fatalf("abrir store: %v", err)
	}
	for _, table := range []string{"sessoes", "eventos", "usuarios"} {
		var n int
		if err := s.db.QueryRow(
			`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table,
		).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Fatalf("tabela %q não foi criada", table)
		}
	}
	for _, idx := range []string{
		"idx_sessoes_status", "idx_sessoes_dono_atual", "idx_sessoes_origem",
		"idx_sessoes_atualizado_em", "idx_eventos_sessao_criado_em",
	} {
		var n int
		if err := s.db.QueryRow(
			`SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?`, idx,
		).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Fatalf("índice %q não foi criado", idx)
		}
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	s2, err := Open(path)
	if err != nil {
		t.Fatalf("reabrir o mesmo banco: %v", err)
	}
	defer s2.Close()
	var migrations int
	if err := s2.db.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&migrations); err != nil {
		t.Fatal(err)
	}
	if migrations != 1 {
		t.Fatalf("esperava 1 migration registrada, tem %d", migrations)
	}
}

// FKs têm que estar ON na prática: apagar a sessão leva os eventos junto
// (ON DELETE CASCADE). Se o PRAGMA do DSN não fosse aplicado, o CASCADE
// silenciosamente não roda.
func TestEventosCascadeComForeignKeys(t *testing.T) {
	s := openTestStore(t)

	res, err := s.db.Exec(`INSERT INTO sessoes
		(titulo, objetivo, status, criador_email, dono_atual_email, criado_em, atualizado_em)
		VALUES ('t', 'o', 'em_andamento', 'a@corp', 'a@corp', 1, 1)`)
	if err != nil {
		t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	if _, err := s.db.Exec(
		`INSERT INTO eventos (sessao_id, tipo, autor_email, criado_em) VALUES (?, 'criacao', 'a@corp', 1)`, id,
	); err != nil {
		t.Fatal(err)
	}

	if _, err := s.db.Exec(`DELETE FROM sessoes WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM eventos`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("eventos deveriam ter sido apagados junto com a sessão, sobraram %d", n)
	}
}

func TestUpsertUsuario(t *testing.T) {
	s := openTestStore(t)

	if err := s.UpsertUsuario("ana@corp", "Ana"); err != nil {
		t.Fatal(err)
	}
	u, ok, err := s.UsuarioPorEmail("ana@corp")
	if err != nil || !ok {
		t.Fatalf("usuário recém-inserido não encontrado: ok=%v err=%v", ok, err)
	}
	if u.Nome != "Ana" {
		t.Fatalf("nome = %q, queria %q", u.Nome, "Ana")
	}

	// Segunda visita atualiza o nome, sem duplicar linha.
	if err := s.UpsertUsuario("ana@corp", "Ana Souza"); err != nil {
		t.Fatal(err)
	}
	u, _, err = s.UsuarioPorEmail("ana@corp")
	if err != nil {
		t.Fatal(err)
	}
	if u.Nome != "Ana Souza" {
		t.Fatalf("nome após upsert = %q, queria %q", u.Nome, "Ana Souza")
	}

	// E-mail nunca visto não é erro, só ok=false.
	_, ok, err = s.UsuarioPorEmail("ninguem@corp")
	if err != nil || ok {
		t.Fatalf("e-mail desconhecido: ok=%v err=%v", ok, err)
	}
}

// Os nomes dos arquivos de migration embutidos seguem o padrão que
// migrationVersion exige — protege contra um rename que quebraria o boot.
func TestMigrationsNomesValidos(t *testing.T) {
	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) == 0 {
		t.Fatal("nenhuma migration embutida")
	}
	for _, e := range entries {
		if _, err := migrationVersion(e.Name()); err != nil {
			t.Errorf("%v", err)
		}
	}
}
