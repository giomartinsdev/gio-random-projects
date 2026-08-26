// Package rooms holds every bit of state this app has: the live
// rooms and who is connected to each one. The room registry itself
// (code, password hash, resume key) is persisted to disk when the
// caller configures a path -- see store.go -- so a redeploy doesn't
// end sessions in progress. Who is actually connected is never
// persisted: those are live WebSockets that die with the process
// anyway, and every client reconnects and re-announces itself.
package rooms

import (
	"crypto/rand"
	"crypto/subtle"
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"

	"golang.org/x/crypto/scrypt"
)

var (
	ErrNotFound     = errors.New("sala não encontrada")
	ErrWrongSecret  = errors.New("senha incorreta")
	ErrTooManyRooms = errors.New("limite de salas atingido, tente de novo em alguns minutos")
)

const (
	// Rooms are pure memory (or a tiny JSON file), so the only real
	// bound on them is this. Generous for the intended use (a handful
	// of people sharing a screen) and low enough that nobody can
	// exhaust the process by looping on POST /api/rooms.
	maxRooms = 500
	// An empty room lingers this long before the janitor drops it, so
	// the host reloading the page or losing wifi doesn't destroy a
	// room everyone else still has the link to.
	emptyRoomGrace = 10 * time.Minute
	// Hard ceiling regardless of activity.
	maxRoomAge = 12 * time.Hour
)

// scrypt parameters -- deliberately the interactive-login preset.
// Room passwords are short-lived and low-value, but they're still
// typed by humans and therefore guessable, so brute-forcing a stolen
// registry should stay expensive.
const (
	scryptN      = 1 << 15
	scryptR      = 8
	scryptP      = 1
	scryptKeyLen = 32
)

type Room struct {
	ID        string
	CreatedAt time.Time

	salt []byte
	hash []byte
	// Signs resume tokens for this room's peers. Persisted with the
	// room so a token issued before a restart still verifies after one
	// -- which is the whole point: it lets someone reclaim their peer
	// identity across a deploy instead of coming back as a stranger.
	resumeKey []byte

	mu        sync.Mutex
	peers     map[string]*Peer
	nextLabel int
	emptyAt   time.Time // zero while anyone is connected
	lastSeen  time.Time
}

type Registry struct {
	mu    sync.Mutex
	rooms map[string]*Room
	now   func() time.Time
	// Where rooms are persisted. Empty means memory only -- which is
	// what the tests use, and what a deploy without a volume gets.
	path string
}

func NewRegistry(path string) *Registry {
	return &Registry{rooms: make(map[string]*Room), now: time.Now, path: path}
}

// Create makes a room whose password is `password`. The password is
// the only credential there is: everyone who has it is a full
// participant who can both publish a stream and watch the others.
func (r *Registry) Create(password string) (*Room, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return nil, err
	}
	hash, err := scrypt.Key([]byte(password), salt, scryptN, scryptR, scryptP, scryptKeyLen)
	if err != nil {
		return nil, err
	}
	resumeKey := make([]byte, 32)
	if _, err := rand.Read(resumeKey); err != nil {
		return nil, err
	}

	// Not deferred: persist() takes this same mutex, so the lock has to
	// be released before calling it rather than at function exit.
	r.mu.Lock()

	if len(r.rooms) >= maxRooms {
		r.mu.Unlock()
		return nil, ErrTooManyRooms
	}

	var id string
	for {
		candidate, err := randomRoomCode()
		if err != nil {
			r.mu.Unlock()
			return nil, err
		}
		if _, taken := r.rooms[candidate]; !taken {
			id = candidate
			break
		}
	}

	now := r.now()
	room := &Room{
		ID:        id,
		CreatedAt: now,
		salt:      salt,
		hash:      hash,
		resumeKey: resumeKey,
		peers:     make(map[string]*Peer),
		emptyAt:   now,
		lastSeen:  now,
	}
	r.rooms[id] = room
	r.mu.Unlock()

	r.persist()
	return room, nil
}

func (r *Registry) Get(id string) (*Room, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	room, ok := r.rooms[id]
	if !ok {
		return nil, ErrNotFound
	}
	return room, nil
}

// Sweep drops rooms nobody has been connected to for a while, and any
// room that has simply been around too long. Called on a ticker by
// StartJanitor.
func (r *Registry) Sweep() {
	now := r.now()
	removed := false
	r.mu.Lock()
	for id, room := range r.rooms {
		room.mu.Lock()
		empty := len(room.peers) == 0
		expired := (empty && !room.emptyAt.IsZero() && now.Sub(room.emptyAt) > emptyRoomGrace) ||
			now.Sub(room.CreatedAt) > maxRoomAge
		room.mu.Unlock()
		if expired {
			delete(r.rooms, id)
			removed = true
		}
	}
	r.mu.Unlock()

	if removed {
		r.persist()
	}
}

func (r *Registry) StartJanitor(stop <-chan struct{}) {
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				r.Sweep()
			case <-stop:
				return
			}
		}
	}()
}

func (r *Registry) Count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.rooms)
}

// RoomSummary is the public view of a room for the home page's "salas
// rolando" list -- never the password, its hash, or the resume key.
type RoomSummary struct {
	ID         string    `json:"roomId"`
	People     int       `json:"people"`
	Publishing int       `json:"publishing"`
	CreatedAt  time.Time `json:"createdAt"`
}

// Active lists every room with at least one person connected right
// now, most people first. A room that exists but is empty (still
// inside its post-disconnect grace period, see Sweep) is left off on
// purpose -- "rolando" means someone is actually there, not just that
// the code hasn't expired yet.
func (r *Registry) Active() []RoomSummary {
	r.mu.Lock()
	defer r.mu.Unlock()

	out := make([]RoomSummary, 0, len(r.rooms))
	for _, room := range r.rooms {
		people := room.PeerCount()
		if people == 0 {
			continue
		}
		out = append(out, RoomSummary{
			ID:         room.ID,
			People:     people,
			Publishing: room.PublisherCount(),
			CreatedAt:  room.CreatedAt,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].People > out[j].People })
	return out
}

// CheckPassword is deliberately the slow scrypt comparison rather than
// a cached boolean: it's the only thing standing between a room code
// and a stranger watching the screen.
func (room *Room) CheckPassword(password string) bool {
	got, err := scrypt.Key([]byte(password), room.salt, scryptN, scryptR, scryptP, scryptKeyLen)
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(got, room.hash) == 1
}

// RandomID generates per-connection peer ids (see httpapi's WebSocket
// handler). Peer ids are only meaningful inside one room, but they're
// unguessable anyway so nobody can address a peer they haven't been
// told about.
func RandomID(n int) (string, error) {
	return randomString(n)
}

func randomString(n int) (string, error) {
	const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	return randomFrom(alphabet, n)
}

// randomRoomCode builds a code like "abacate98suco" -- two distinct
// small Portuguese words around a 2-digit number, instead of the old
// opaque "DRFG2478". People say these out loud and type them on a
// phone keyboard; "abacate 98 suco" survives that far better than a
// string with no vowels to anchor on.
func randomRoomCode() (string, error) {
	w1, err := randomWord()
	if err != nil {
		return "", err
	}
	w2, err := randomWord()
	if err != nil {
		return "", err
	}
	for w2 == w1 {
		if w2, err = randomWord(); err != nil {
			return "", err
		}
	}
	n, err := randomDigitPair()
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s%d%s", w1, n, w2), nil
}

// randomDigitPair returns a number in [10, 99] -- always two digits,
// so the code's shape (word, two digits, word) is predictable even
// though the value isn't.
func randomDigitPair() (int, error) {
	buf := make([]byte, 1)
	const span = 90 // 99 - 10 + 1
	limit := byte(256 - (256 % span))
	for {
		if _, err := rand.Read(buf); err != nil {
			return 0, err
		}
		if buf[0] >= limit {
			continue
		}
		return 10 + int(buf[0])%span, nil
	}
}

// Rejection sampling rather than modulo: with an alphabet whose length
// doesn't divide 256, plain `b % len` would make the first few
// characters measurably more likely.
func randomFrom(alphabet string, n int) (string, error) {
	out := make([]byte, 0, n)
	buf := make([]byte, 1)
	limit := byte(256 - (256 % len(alphabet)))
	for len(out) < n {
		if _, err := rand.Read(buf); err != nil {
			return "", err
		}
		if buf[0] >= limit {
			continue
		}
		out = append(out, alphabet[int(buf[0])%len(alphabet)])
	}
	return string(out), nil
}
