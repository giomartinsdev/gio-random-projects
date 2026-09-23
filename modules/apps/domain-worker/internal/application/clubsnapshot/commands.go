// Package clubesnapshot holds the Command payload for the snapshot append —
// it travels the platform's async 202 path (high volume, append-only, nobody
// waits for the answer).
package clubesnapshot

// AppendInput is the clubesnapshot.append payload.
type AppendInput struct {
	ClubID        string `json:"club_id"`
	SkillRating         int    `json:"skill_rating"`
	DivisionAtRead       int    `json:"division_at_read"`
	Played         int    `json:"played"`
	Wins      int    `json:"wins"`
	Draws       int    `json:"draws"`
	Losses      int    `json:"losses"`
	Goals          int    `json:"goals"`
	GoalsConceded  int    `json:"goals_conceded"`
	SquadSize int    `json:"squad_size"`
}
