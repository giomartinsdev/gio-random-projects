package httpapi

import (
	"bytes"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/clips"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/rooms"
)

// maxClipBytes bounds one upload. A five-minute screen recording at
// the bitrate the client records (2.5 Mb/s) lands around 90-100 MB;
// this ceiling sits above that with headroom, while still refusing a
// runaway or hostile upload long before it matters.
const maxClipBytes = 150 << 20

// RegisterClips wires the clip routes. The store decides where bytes
// actually live (memory fallback vs MinIO); ttl is how long a clip
// survives after upload.
func (s *Server) RegisterClips(store clips.Store, ttl time.Duration) {
	s.clipStore = store
	s.clipTTL = ttl
	s.mux.HandleFunc("POST /api/clips", s.handleCreateClip)
	s.mux.HandleFunc("GET /api/clips", s.handleListClips)
	s.mux.HandleFunc("GET /api/clips/{id}/download", s.handleDownloadClip)
}

// handleCreateClip takes a finished WebM (assembled by the
// publisher's own MediaRecorder ring buffer -- see
// tela-frontend's clipRecorder.ts) plus the room credentials, and
// files it away. Multipart, not raw-body-with-headers: fields ride in
// the same request as the bytes, and multipart's Content-Type keeps
// the browser out of CORS preflight for the upload.
//
// Auth is the room password, same as everything else in tela: being
// able to prove you were IN the room is exactly the credential for
// cutting a clip of what you were seeing.
func (s *Server) handleCreateClip(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if !s.limiter.allow(ip) {
		writeError(w, http.StatusTooManyRequests, "muitas tentativas, espere um pouco")
		return
	}

	fields, data, err := readClipUpload(w, r)
	if err != nil {
		// readClipUpload already wrote the error response.
		return
	}

	room, err := s.registry.Get(strings.ToLower(fields["room"]))
	if err != nil {
		writeError(w, http.StatusNotFound, rooms.ErrNotFound.Error())
		return
	}
	if !room.CheckPassword(fields["password"]) {
		s.limiter.fail(ip)
		writeError(w, http.StatusUnauthorized, rooms.ErrWrongSecret.Error())
		return
	}
	s.limiter.reset(ip)

	if len(data) == 0 {
		writeError(w, http.StatusBadRequest, "clip vazio")
		return
	}

	id, err := clips.RandomID()
	if err != nil {
		s.log.ErrorContext(r.Context(), "clip id", "error", err)
		writeError(w, http.StatusInternalServerError, "não foi possível salvar o clip")
		return
	}
	name := sanitizeName(fields["name"])
	if name == "" {
		name = "Clip"
	}
	now := time.Now()
	clip := clips.Clip{
		ID:        id,
		RoomID:    room.ID,
		Name:      name,
		// The handler owns the bytes, so it owns the size too -- the
		// S3 store passes it straight to PutObject, which would
		// otherwise upload a zero-length object.
		Size:      int64(len(data)),
		CreatedAt: now,
		ExpiresAt: now.Add(s.clipTTL),
	}

	if err := s.clipStore.Save(r.Context(), clip, bytes.NewReader(data)); err != nil {
		if errors.Is(err, clips.ErrTooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, err.Error())
			return
		}
		s.log.ErrorContext(r.Context(), "clip save failed", "error", err)
		writeError(w, http.StatusInternalServerError, "não foi possível salvar o clip")
		return
	}

	s.log.InfoContext(r.Context(), "clip saved", "clip_id", clip.ID, "room_id", clip.RoomID, "bytes", clip.Size)
	writeJSON(w, http.StatusCreated, clip)
}

// readClipUpload parses the multipart body by hand (no temp files, no
// spooling): small fields are read whole, the clip part is read up to
// maxClipBytes and rejected if it goes one byte past. Every response
// on the way out is written here; a nil error means "fields and bytes
// are ready".
func readClipUpload(w http.ResponseWriter, r *http.Request) (map[string]string, []byte, error) {
	writeBad := func(status int, msg string) (map[string]string, []byte, error) {
		writeError(w, status, msg)
		return nil, nil, errors.New(msg)
	}

	mr, err := r.MultipartReader()
	if err != nil {
		return writeBad(http.StatusBadRequest, "corpo inválido")
	}

	fields := make(map[string]string, 3)
	var data []byte
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return writeBad(http.StatusBadRequest, "corpo inválido")
		}
		switch part.FormName() {
		case "room", "password", "name":
			b, err := io.ReadAll(io.LimitReader(part, 4*1024))
			part.Close()
			if err != nil {
				return writeBad(http.StatusBadRequest, "corpo inválido")
			}
			fields[part.FormName()] = strings.TrimSpace(string(b))
		case "clip":
			b, err := io.ReadAll(io.LimitReader(part, maxClipBytes+1))
			part.Close()
			if err != nil {
				return writeBad(http.StatusBadRequest, "não foi possível ler o clip")
			}
			if len(b) > maxClipBytes {
				return writeBad(http.StatusRequestEntityTooLarge, "clip grande demais")
			}
			data = b
		default:
			// Unknown fields are drained (not skipped silently without
			// reading) so the multipart walk stays on the boundary.
			_, _ = io.Copy(io.Discard, io.LimitReader(part, 1<<20))
			part.Close()
		}
	}
	return fields, data, nil
}

// handleListClips feeds the home page's Clips section: every live
// clip, newest first, metadata only. Deliberately unauthenticated --
// the same way GET /api/rooms lists the live rooms; the clip bytes
// are guarded by their unguessable ids, not by this list.
func (s *Server) handleListClips(w http.ResponseWriter, r *http.Request) {
	list, err := s.clipStore.List(r.Context())
	if err != nil {
		s.log.ErrorContext(r.Context(), "clip list failed", "error", err)
		writeError(w, http.StatusInternalServerError, "não foi possível listar os clips")
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// handleDownloadClip streams the bytes back. The id in the URL is a
// bearer credential (110 bits of randomness), so there's no password
// check here -- but the id is ALSO validated against a strict shape,
// because it becomes part of an S3 object key and anything with a
// slash or dots in it must never get that far.
func (s *Server) handleDownloadClip(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validClipID(id) {
		writeError(w, http.StatusNotFound, clips.ErrNotFound.Error())
		return
	}

	clip, rc, err := s.clipStore.Open(r.Context(), id)
	if err != nil {
		if errors.Is(err, clips.ErrNotFound) {
			writeError(w, http.StatusNotFound, clips.ErrNotFound.Error())
			return
		}
		s.log.ErrorContext(r.Context(), "clip open failed", "clip_id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "não foi possível baixar o clip")
		return
	}
	defer rc.Close()

	// Both filename forms: the ASCII fallback for ancient clients, the
	// UTF-8 one for the name the person actually typed.
	fallback := "clip-" + clip.CreatedAt.Format("2006-01-02") + ".webm"
	disposition := mime.FormatMediaType("attachment", map[string]string{
		"filename":  fallback,
		"filename*": "utf-8''" + url.PathEscape(clip.Name+".webm"),
	})

	w.Header().Set("Content-Type", "video/webm")
	w.Header().Set("Content-Length", strconv.FormatInt(clip.Size, 10))
	w.Header().Set("Content-Disposition", disposition)
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, rc)
}

func validClipID(id string) bool {
	if len(id) == 0 || len(id) > 64 {
		return false
	}
	for _, c := range id {
		switch {
		case c >= 'a' && c <= 'z', c >= '0' && c <= '9':
		default:
			return false
		}
	}
	return true
}
