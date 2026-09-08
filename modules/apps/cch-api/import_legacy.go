package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"os"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/cch-api/internal/customdecks"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/cch-api/internal/domainapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/cch-api/internal/rooms"
)

// The one-time cutover from the old JSON stores. Until this deploy, the
// room registry lived in /data/rooms.json and the marketplace in
// /data/custom-decks.json on the cch-state volume; from now on they
// live in domain-api's cch_rooms and cch_custom_decks tables. On the
// first boot against an empty table with a JSON file still present, its
// records are pushed through the sync route one by one and the file is
// renamed to *.imported -- the record of what happened stays on the
// volume, but the service never reads it again.
//
// Safety properties, in order of importance:
//
//   - Every write is an idempotent upsert keyed by the record's own id,
//     so a crash mid-import (or a 504 with the command still queued)
//     just means the next boot re-imports everything -- landing on the
//     same rows, not duplicating them.
//   - The import only renames the file after every record was confirmed
//     written; a queued/failed record leaves the file in place.
//   - Records the worker permanently rejects (422) are skipped with a
//     log line rather than wedging the cutover -- retrying them would
//     fail identically forever.
//   - The import only runs while the domain table is empty. Once
//     anything is in there, the database is the source of truth and the
//     leftover file is inert.
func importLegacyRooms(client *domainapi.Client, path string) {
	if !client.Enabled() || path == "" {
		return
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("[cch] could not read legacy rooms file %q: %v", path, err)
		}
		return
	}
	var stored []rooms.StoredRoom
	if err := json.Unmarshal(data, &stored); err != nil {
		log.Printf("[cch] legacy rooms file %q is not parseable, ignoring: %v", path, err)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	existing, err := client.ListRooms(ctx)
	if err != nil {
		log.Printf("[cch] rooms import postponed: could not query domain: %v", err)
		return
	}
	if len(existing) > 0 {
		return // already cut over (or another instance imported) -- file is inert
	}

	for _, room := range stored {
		if _, err := client.Sync(ctx, "cchroom.create", domainapi.RoomInput{
			ID:        room.ID,
			CreatedAt: room.CreatedAt,
			Salt:      room.Salt,
			Hash:      room.Hash,
			ResumeKey: room.ResumeKey,
		}); err != nil {
			if errors.Is(err, domainapi.ErrRejected) {
				log.Printf("[cch] legacy room %q rejected by domain, skipping: %v", room.ID, err)
				continue
			}
			log.Printf("[cch] rooms import postponed to next boot: %v", err)
			return
		}
	}
	if err := os.Rename(path, path+".imported"); err != nil {
		log.Printf("[cch] rooms imported but could not rename %q: %v", path, err)
		return
	}
	log.Printf("[cch] imported %d rooms from the legacy JSON store", len(stored))
}

// importLegacyDecks is importLegacyRooms for the marketplace file. Same
// contract; the only difference is the deck's shape (and that a deck
// the worker rejects is the expected case for a deck written by an
// older, looser validation).
func importLegacyDecks(client *domainapi.Client, path string) {
	if !client.Enabled() || path == "" {
		return
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("[cch] could not read legacy decks file %q: %v", path, err)
		}
		return
	}
	var stored []customdecks.Deck
	if err := json.Unmarshal(data, &stored); err != nil {
		log.Printf("[cch] legacy decks file %q is not parseable, ignoring: %v", path, err)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	existing, err := client.ListDecks(ctx)
	if err != nil {
		log.Printf("[cch] decks import postponed: could not query domain: %v", err)
		return
	}
	if len(existing) > 0 {
		return
	}

	for _, deck := range stored {
		if _, err := client.Sync(ctx, "cchdeck.upsert", domainapi.DeckUpsert{
			ID:          deck.ID,
			Name:        deck.Name,
			Emoji:       deck.Emoji,
			Description: deck.Description,
			ParentID:    deck.ParentID,
			Author:      deck.Author,
			Whites:      deck.Whites,
			Blacks:      deck.Blacks,
			CreatedAt:   deck.CreatedAt,
			Plays:       deck.Plays,
		}); err != nil {
			if errors.Is(err, domainapi.ErrRejected) {
				log.Printf("[cch] legacy deck %q rejected by domain, skipping: %v", deck.ID, err)
				continue
			}
			log.Printf("[cch] decks import postponed to next boot: %v", err)
			return
		}
	}
	if err := os.Rename(path, path+".imported"); err != nil {
		log.Printf("[cch] decks imported but could not rename %q: %v", path, err)
		return
	}
	log.Printf("[cch] imported %d custom decks from the legacy JSON store", len(stored))
}