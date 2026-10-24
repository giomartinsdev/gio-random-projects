package finance

import (
	"errors"
	"time"
)

var (
	ErrBudgetIDRequired = errors.New("budget_id is required")
	ErrLimitInvalid     = errors.New("budget limit must be positive")
	ErrPeriodInvalid    = errors.New("period must be YYYY-MM")
)

// Budget é o agregado do §3.3: limite mensal por categoria, com réguas
// 50/80/100%. As réguas disparam uma vez por limiar por período (§3.4 nº5) —
// o "uma vez" é garantido pela tabela de disparos (RecordThreshold devolve false
// na segunda tentativa).
type Budget struct {
	ID       string
	UserID   string
	Category string
	Limit    Money
	Period   string // "YYYY-MM"
	CreatedAt time.Time
}

// Thresholds são as réguas do §3.3, na ordem.
var Thresholds = []int{50, 80, 100}

func NewBudget(id, userID, category string, limit Money, period string) (Budget, error) {
	if id == "" {
		return Budget{}, ErrBudgetIDRequired
	}
	if limit.Cents <= 0 {
		return Budget{}, ErrLimitInvalid
	}
	if !validPeriod(period) {
		return Budget{}, ErrPeriodInvalid
	}
	return Budget{
		ID:       id,
		UserID:   userID,
		Category: category,
		Limit:    limit,
		Period:   period,
		CreatedAt: time.Now().UTC(),
	}, nil
}

// CrossedThresholds devolve as réguas já cruzadas por um gasto acumulado
// (em centavos). 50% de 100,00 = 50,00 → cruza 50. É o cálculo puro que os
// testes de "uma vez por limiar" exercitam sem banco.
func (b Budget) CrossedThresholds(spentCents int64) []int {
	out := []int{}
	for _, t := range Thresholds {
		// spent >= ceil(limit * t / 100) — comparação inteira, sem float.
		need := (b.Limit.Cents*int64(t) + 99) / 100
		if spentCents >= need {
			out = append(out, t)
		}
	}
	return out
}

func validPeriod(p string) bool {
	if len(p) != 7 || p[4] != '-' {
		return false
	}
	for i, r := range p {
		if i == 4 {
			continue
		}
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}
