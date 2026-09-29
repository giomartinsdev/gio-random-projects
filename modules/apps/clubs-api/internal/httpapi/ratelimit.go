package httpapi

import (
	"sync"
	"time"
)

// Rate limit do sync sob demanda.
//
// Por que existe: "sincronizar meus clubes" dispara a descoberta de três níveis
// -- dezenas de consultas à fonte (EA/CDN), que bloqueia por IP quando vê
// rajada. Sem limite, dois cliques (ou um clique nervoso) viram carga contra o
// CDN e podem derrubar a coleta de TODO mundo. O limite é por pessoa, não
// global: uma pessoa repetindo o clique não pode impedir as outras.
//
// A janela é de 30 min, alinhada ao ciclo do worker: pedir de novo dentro dele
// não traria dado mais novo, só gastaria consulta.
//
// O estado é em MEMÓRIA do processo, de propósito: é um freio de curto prazo,
// não um dado do produto. Um restart do clubs-api zera a janela -- o pior caso
// é permitir um sync a mais, que é benigno. Guardar em banco por 30 min de
// proteção seria overkill e mais uma tabela para manter.
const syncCooldown = 30 * time.Minute

type syncLimiter struct {
	mu       sync.Mutex
	lastSeen map[string]time.Time
}

func newSyncLimiter() *syncLimiter {
	return &syncLimiter{lastSeen: map[string]time.Time{}}
}

// allow registra uma tentativa e diz se ela é permitida. Quando negada, devolve
// quanto falta para a próxima janela -- para a resposta poder dizer "tente em
// N min" em vez de um "não" seco.
//
// A decisão é atômica sob o lock: duas requisições simultâneas da mesma pessoa
// não podem as duas passar (o que anularia o limite).
func (l *syncLimiter) allow(email string, now time.Time) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if ultimo, ok := l.lastSeen[email]; ok {
		if falta := syncCooldown - now.Sub(ultimo); falta > 0 {
			return false, falta
		}
	}
	l.lastSeen[email] = now
	return true, 0
}

// peek diz quanto falta sem registrar uma tentativa -- para a tela mostrar o
// botão desabilitado com a contagem antes de a pessoa clicar.
func (l *syncLimiter) peek(email string, now time.Time) time.Duration {
	l.mu.Lock()
	defer l.mu.Unlock()
	if ultimo, ok := l.lastSeen[email]; ok {
		if falta := syncCooldown - now.Sub(ultimo); falta > 0 {
			return falta
		}
	}
	return 0
}
