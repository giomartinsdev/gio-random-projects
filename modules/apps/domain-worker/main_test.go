package main

import (
	"encoding/json"
	"testing"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	appfinance "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/finance"
	appprospecta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/prospecta"
)

// Os payloads abaixo são cópias BYTE A BYTE do que os produtores publicam:
// domain-api's appclubs.FetchRunInput/SearchRunInput/CareerInput/
// IngestEstadoInput e clubs-ingest's client.py. Se um rename futuro mudar um
// lado só, o campo vira zero em silêncio -- json.Unmarshal ignora chave
// desconhecida. Foi exatamente essa a falha que o codemod introduziu aqui:
// renomeou os produtores e pulou este arquivo (na raiz do módulo, fora de
// internal/), e a fila de resgate passou a gravar linhas vazias sem erro.
func TestClubsCommandPayloadsMatchProducers(t *testing.T) {
	t.Run("fetch request (domain-api FetchRunInput)", func(t *testing.T) {
		var in clubsFetchPayload
		mustUnmarshal(t, `{"target":"clube","target_id":"7340","running":true}`, &in)
		if in.Target != "clube" || in.TargetID != "7340" {
			t.Fatalf("alvo/target_id não decodificaram: %+v", in)
		}
	})

	t.Run("fetch save (clubs-ingest client.py)", func(t *testing.T) {
		var in clubsFetchSavePayload
		mustUnmarshal(t, `{"target":"jogador","target_id":"p1","label":"x","running":false,"players":18,"matches":4,"clubs":4,"error":"","concluido":true}`, &in)
		if in.Target != "jogador" || in.TargetID != "p1" || in.Players != 18 || in.Matches != 4 || in.Clubs != 4 || !in.Concluido {
			t.Fatalf("payload de fetch-save não decodificou: %+v", in)
		}
	})

	t.Run("search save (clubs-ingest client.py)", func(t *testing.T) {
		var in clubsSearchSavePayload
		mustUnmarshal(t, `{"termo":"vilanova","running":false,"found":1,"error":"","concluido":true}`, &in)
		if in.Termo != "vilanova" || in.Found != 1 || !in.Concluido {
			t.Fatalf("payload de search-save não decodificou: %+v", in)
		}
	})

	t.Run("career (clubs-ingest career_line)", func(t *testing.T) {
		var in clubsCareerPayload
		mustUnmarshal(t, `{"club_id":"1001","gamertag":"pro","played":12,"goals":21,"assists":8,"man_of_the_match":3,"rating":8.5,"position":"midfielder"}`, &in)
		if in.ClubID != "1001" || in.Played != 12 || in.Goals != 21 || in.Assists != 8 || in.ManOfTheMatch != 3 || in.Rating != 8.5 || in.Position != "midfielder" {
			t.Fatalf("payload de career não decodificou: %+v", in)
		}
	})

	t.Run("ingest health (clubs-ingest client.py)", func(t *testing.T) {
		var in clubsIngestPayload
		mustUnmarshal(t, `{"cycles":7,"clubs_ok":22,"clubs_failed":0,"new_matches":3,"snapshots":22,"bootstrapped":true,"last_error":"","source_available":false,"source_error":"clubs/info: 403"}`, &in)
		if in.Cycles != 7 || in.ClubsOK != 22 || in.NewMatches != 3 || in.Snapshots != 22 || !in.Bootstrapped {
			t.Fatalf("payload de ingest-health não decodificou: %+v", in)
		}
		if in.SourceAvailable || in.SourceError == "" {
			t.Fatalf("saúde da fonte não decodificou: %+v", in)
		}
	})
}

func mustUnmarshal(t *testing.T, payload string, dst any) {
	t.Helper()
	if err := json.Unmarshal([]byte(payload), dst); err != nil {
		t.Fatalf("unmarshal %s: %v", payload, err)
	}
}

// Os payloads finance.* são cópias do que a finance-api publica (o envelope
// {action, payload} que ela relaya). Mesma regra do clubs: um rename de um lado
// só vira campo zero em silêncio. Trava o contrato contra os campos que o
// domain-worker realmente lê.
func TestFinanceCommandPayloadsMatchProducers(t *testing.T) {
	t.Run("register transaction", func(t *testing.T) {
		var in appfinance.RegisterTransactionInput
		mustUnmarshal(t, `{"user_id":"5521981962914","account_id":"acct-1","transaction_type":"EXPENSE","amount":"45.00","currency":"BRL","category":"Alimentação","occurred_at":"2026-10-04T12:00:00+00:00","source_type":"WHATSAPP_MANUAL"}`, &in)
		if in.UserID != "5521981962914" || in.Type != "EXPENSE" || in.Amount != "45.00" || in.Currency != "BRL" {
			t.Fatalf("payload de register não decodificou: %+v", in)
		}
	})
	t.Run("categorize transaction", func(t *testing.T) {
		var in appfinance.CategorizeTransactionInput
		mustUnmarshal(t, `{"transaction_id":"x","category":"Lazer"}`, &in)
		if in.TransactionID != "x" || in.Category != "Lazer" {
			t.Fatalf("payload de categorize não decodificou: %+v", in)
		}
	})
	t.Run("transfer between accounts", func(t *testing.T) {
		var in appfinance.TransferBetweenAccountsInput
		mustUnmarshal(t, `{"user_id":"u","from_account_id":"a","to_account_id":"b","amount":"100.00","currency":"BRL","occurred_at":"2026-10-04T12:00:00+00:00"}`, &in)
		if in.FromAccountID != "a" || in.ToAccountID != "b" || in.Amount != "100.00" {
			t.Fatalf("payload de transfer não decodificou: %+v", in)
		}
	})
	t.Run("set category budget", func(t *testing.T) {
		var in appfinance.SetCategoryBudgetInput
		mustUnmarshal(t, `{"user_id":"u","category":"Alimentação","limit":"600.00","currency":"BRL","period":"2026-10"}`, &in)
		if in.Category != "Alimentação" || in.Limit != "600.00" || in.Period != "2026-10" {
			t.Fatalf("payload de budget não decodificou: %+v", in)
		}
	})
}

// classifyClubsAction é a defesa contra a colisão de prefixo que quebrou a
// tela de resgate em produção: "clubs.fetchRun" também casa com o prefixo
// "clubs.", e quando o case genérico vinha primeiro o pedido de fetch caía no
// upsert da saúde do worker -- gravando zeros nela e nunca criando a linha da
// fila. O clique não fazia nada e NÃO havia erro.
//
// O teste fixa que cada ação da família vai para o seu próprio destino.
func TestClassifyClubsAction(t *testing.T) {
	cases := map[application.Action]clubsKind{
		application.ActionSaveIngestEstado: clubsKindIngestHealth,
		application.ActionRequestFetchRun:  clubsKindFetch,
		application.ActionSaveFetchRun:     clubsKindFetchSave,
		application.ActionRequestSearchRun: clubsKindSearch,
		application.ActionSaveSearchRun:    clubsKindSearchSave,
		// Qualquer outra ação clubs. continua indo para o genérico -- o
		// default não pode virar um "unknown action" e derrubar o worker.
		application.Action("clubs.qualquerOutra"): clubsKindOther,
	}
	for action, want := range cases {
		if got := classifyClubsAction(action); got != want {
			t.Errorf("classifyClubsAction(%q) = %v; want %v", action, got, want)
		}
	}
}

// A regressão específica: o pedido de fetch e a saúde do worker são destinos
// DIFERENTES. Se voltarem a colidir, a tela de resgate para de funcionar.
func TestFetchRequestIsNotMistakenForIngestHealth(t *testing.T) {
	if classifyClubsAction(application.ActionRequestFetchRun) == classifyClubsAction(application.ActionSaveIngestEstado) {
		t.Fatal("clubs.fetchRun deve ir para o fetch, não para a saúde do worker")
	}
}

// A busca ao vivo tem os seus dois destinos, e nenhum deles pode colidir com
// o fetch -- os três compartilham o prefixo "clubs.".
func TestSearchActionsHaveTheirOwnDestinations(t *testing.T) {
	if classifyClubsAction(application.ActionRequestSearchRun) == classifyClubsAction(application.ActionRequestFetchRun) {
		t.Fatal("clubs.searchRun não pode ir para o mesmo destino do fetch")
	}
	if classifyClubsAction(application.ActionSaveSearchRun) == classifyClubsAction(application.ActionSaveFetchRun) {
		t.Fatal("os dois saves não podem colidir")
	}
}

// Os payloads do Prospecta são cópias do que a prospecta-api publica (o
// envelope {action, payload}). Mesma regra de clubs/finance: um rename de um
// lado só vira campo zero em silêncio. A action é o NOME do comando em
// PascalCase (o formato do contrato §7.2), não a família dotted das outras.
func TestProspectaCommandPayloadsMatchProducers(t *testing.T) {
	if got := string(application.ActionCreateCompany); got != "CreateCompany" {
		t.Fatalf("ActionCreateCompany = %q; want %q (contrato)", got, "CreateCompany")
	}
	if got := string(application.ActionDefineICP); got != "DefineICP" {
		t.Fatalf("ActionDefineICP = %q; want %q (contrato)", got, "DefineICP")
	}
	t.Run("create company", func(t *testing.T) {
		var in appprospecta.CreateCompanyInput
		mustUnmarshal(t, `{"tenant_id":"t","name":"ACME","site":"acme.com","description":"vende"}`, &in)
		if in.TenantID != "t" || in.Name != "ACME" || in.Site != "acme.com" || in.Description != "vende" {
			t.Fatalf("payload de create company não decodificou: %+v", in)
		}
	})
	t.Run("define icp", func(t *testing.T) {
		var in appprospecta.DefineICPInput
		mustUnmarshal(t, `{"tenant_id":"t","company_id":"c","definition":"transportadoras","signals":["frota","novo CD"]}`, &in)
		if in.TenantID != "t" || in.CompanyID != "c" || in.Definition != "transportadoras" {
			t.Fatalf("payload de define icp não decodificou: %+v", in)
		}
		if len(in.Signals) != 2 {
			t.Fatalf("signals = %v; want 2", in.Signals)
		}
	})
	t.Run("create user", func(t *testing.T) {
		if got := string(application.ActionCreateUser); got != "CreateUser" {
			t.Fatalf("ActionCreateUser = %q; want %q (contrato)", got, "CreateUser")
		}
		var in appprospecta.CreateUserInput
		mustUnmarshal(t, `{"tenant_id":"t","company_id":"c","name":"Ana","email":"ana@acme.com","password_hash":"hash-bcrypt-1","role":"admin"}`, &in)
		if in.TenantID != "t" || in.CompanyID != "c" || in.Name != "Ana" || in.Email != "ana@acme.com" || in.PasswordHash != "hash-bcrypt-1" || in.Role != "admin" {
			t.Fatalf("payload de create user não decodificou: %+v", in)
		}
	})
	t.Run("update user password", func(t *testing.T) {
		if got := string(application.ActionUpdateUserPassword); got != "UpdateUserPassword" {
			t.Fatalf("ActionUpdateUserPassword = %q; want %q (contrato)", got, "UpdateUserPassword")
		}
		var in appprospecta.UpdateUserPasswordInput
		mustUnmarshal(t, `{"tenant_id":"t","user_id":"u","password_hash":"hash-bcrypt-2"}`, &in)
		if in.TenantID != "t" || in.UserID != "u" || in.PasswordHash != "hash-bcrypt-2" {
			t.Fatalf("payload de update user password não decodificou: %+v", in)
		}
	})
}
