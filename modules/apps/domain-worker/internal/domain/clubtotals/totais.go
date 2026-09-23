// Package clubetotais is the domain layer for the ClubeTotais aggregate —
// the all-time totals the source returns even for a club the hub does not
// follow. Separate from Club because it exists precisely for clubs that
// will never have a squad or matches, and because its shape changes far
// less often.
package clubetotais

import "time"

type Totais struct {
	ClubID         string
	Played          int
	Wins       int
	Draws        int
	Losses       int
	Goals           int
	GoalsConceded   int
	CleanSheets int
	Points         int
	Division   int
	BestDivision  int
	SkillRating          int
	Promotions      int
	Relegations  int
	ReadAt         time.Time
}
