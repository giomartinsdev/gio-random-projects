package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/domain"
)

// Channel é o canal de WhatsApp de UMA conta. Nunca é global: o token pertence
// ao workspace, e é isso que impede a conta A de mandar pelo número da B.
type Channel struct {
	WorkspaceID  string `json:"-"`
	Mode         string `json:"mode"`
	WABAID       string `json:"wabaId"`
	PhoneID      string `json:"phoneId"`
	TokenCipher  string `json:"-"`
	DisplayPhone string `json:"displayPhone"`
	VerifiedName string `json:"verifiedName"`
	Quality      string `json:"quality"`
}

// Active diz se a conta já ativou o WhatsApp. Canal sem token é canal
// incompleto — e incompleto não envia.
func (c Channel) Active() bool { return c.WorkspaceID != "" && c.TokenCipher != "" }

func (c Channel) Live() bool { return c.Mode == "live" }

// SaveChannel grava (ou substitui) o canal da conta. UPSERT porque reativar é
// operação normal: token expira, número muda, WABA é recriada depois de um
// banimento.
func (s *Store) SaveChannel(ctx context.Context, c Channel) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO channels (workspace_id, mode, waba_id, phone_id, token_cipher,
		                      display_phone, verified_name, quality)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		ON CONFLICT (workspace_id) DO UPDATE SET
		    mode=$2, waba_id=$3, phone_id=$4, token_cipher=$5,
		    display_phone=$6, verified_name=$7, quality=$8, updated_at=now()`,
		c.WorkspaceID, c.Mode, c.WABAID, c.PhoneID, c.TokenCipher,
		c.DisplayPhone, c.VerifiedName, c.Quality)
	if err != nil && isUniqueViolation(err) {
		// Um Phone Number ID pertence a uma conta só. Reaproveitar o mesmo
		// número em duas contas faria o webhook escolher a errada.
		return ErrPhoneInUse
	}
	return err
}

// ErrPhoneInUse é o único conflito possível ao gravar canal.
var ErrPhoneInUse = errors.New("este Phone Number ID já está ativo em outra conta")

// Channel lê o canal da conta. Sem linha = conta nunca ativou.
func (s *Store) Channel(ctx context.Context, ws string) (Channel, error) {
	var c Channel
	err := s.pool.QueryRow(ctx, `
		SELECT workspace_id, mode, waba_id, phone_id, token_cipher,
		       display_phone, verified_name, quality
		FROM channels WHERE workspace_id=$1`, ws).
		Scan(&c.WorkspaceID, &c.Mode, &c.WABAID, &c.PhoneID, &c.TokenCipher,
			&c.DisplayPhone, &c.VerifiedName, &c.Quality)
	if errors.Is(err, pgx.ErrNoRows) {
		return Channel{}, domain.ErrNotFound
	}
	return c, err
}

// ChannelByPhoneID resolve o dono de um Phone Number ID. É o que permite ao
// webhook, que não tem sessão, saber de qual conta é o evento.
func (s *Store) ChannelByPhoneID(ctx context.Context, phoneID string) (Channel, error) {
	var c Channel
	err := s.pool.QueryRow(ctx, `
		SELECT workspace_id, mode, waba_id, phone_id, token_cipher,
		       display_phone, verified_name, quality
		FROM channels WHERE phone_id=$1 AND phone_id<>''`, phoneID).
		Scan(&c.WorkspaceID, &c.Mode, &c.WABAID, &c.PhoneID, &c.TokenCipher,
			&c.DisplayPhone, &c.VerifiedName, &c.Quality)
	if errors.Is(err, pgx.ErrNoRows) {
		return Channel{}, domain.ErrNotFound
	}
	return c, err
}

// DeleteChannel desativa o canal e apaga as credenciais. O workspace continua
// existindo — desativar não é apagar a conta.
func (s *Store) DeleteChannel(ctx context.Context, ws string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM channels WHERE workspace_id=$1`, ws)
	return err
}

// WorkspacesWithChannel lista as contas que podem enviar. O worker usa isto em
// vez de varrer todas: conta sem canal não tem fila para drenar, e tentar
// enviar por ela só produziria erro em laço.
func (s *Store) WorkspacesWithChannel(ctx context.Context) ([]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT workspace_id FROM channels
		WHERE token_cipher<>'' AND phone_id<>''`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var ws string
		if err := rows.Scan(&ws); err != nil {
			return nil, err
		}
		out = append(out, ws)
	}
	return out, rows.Err()
}
