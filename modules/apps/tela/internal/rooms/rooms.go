// Package rooms holds every bit of state this app has: the live
// rooms and who is connected to each one. Nothing is persisted --
// there's no database and no user accounts, so a restart simply drops
// every room, which is the right behaviour for something whose whole
// lifetime is "someone is sharing their screen right now".
package rooms

import (
	"crypto/rand"
	"crypto/subtle"
	"errors"
	"sync"
	"time"

	"golang.org/x/crypto/scrypt"
)

var (
	ErrNotFound     = errors.New("sala não encontrada")
	ErrWrongSecret  = errors.New("senha incorreta")
	ErrTooManyRooms = errors.New("limite de salas atingido, tente de novo em alguns minutos")
)

// Ambiguous characters (0/O, 1/I/L) are left out -- room codes get
// read out loud and typed by hand.
const codeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

const (
	codeLength = 6
	// Rooms are pure memory, so the only real bound on them is this.
	// Generous for the intended use (a handful of people sharing a
	// screen) and low enough that nobody can exhaust the process by
	// looping on POST /api/rooms.
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
}

func NewRegistry() *Registry {
	return &Registry{rooms: make(map[string]*Room), now: time.Now}
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

	r.mu.Lock()
	defer r.mu.Unlock()

	if len(r.rooms) >= maxRooms {
		return nil, ErrTooManyRooms
	}

	var id string
	for {
		candidate, err := randomCode(codeLength)
		if err != nil {
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
		peers:     make(map[string]*Peer),
		emptyAt:   now,
		lastSeen:  now,
	}
	r.rooms[id] = room
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
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, room := range r.rooms {
		room.mu.Lock()
		empty := len(room.peers) == 0
		expired := (empty && !room.emptyAt.IsZero() && now.Sub(room.emptyAt) > emptyRoomGrace) ||
			now.Sub(room.CreatedAt) > maxRoomAge
		room.mu.Unlock()
		if expired {
			delete(r.rooms, id)
		}
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

func randomCode(n int) (string, error) {
	return randomFrom(codeAlphabet, n)
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
