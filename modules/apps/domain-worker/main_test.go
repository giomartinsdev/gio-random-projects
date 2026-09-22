package main

import (
	"testing"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
)

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
