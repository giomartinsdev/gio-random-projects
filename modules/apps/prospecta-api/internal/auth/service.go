package auth

import (
	"context"
	"errors"
	"log/slog"
	"strings"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/application"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/domain"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/identity"
)

// ErrInvalidCredentials is returned by Login for both an unknown e-mail and a
// wrong password. They are deliberately indistinguishable on the wire (401
// either way), so login cannot be used to probe which e-mails exist.
var ErrInvalidCredentials = errors.New("e-mail ou senha inválidos")

// ActionCreateUser is the command that creates the owner account. The pair
// hashes nothing: password_hash arrives already bcrypt-ed from here (or empty
// for a Google-only account).
const ActionCreateUser = "CreateUser"

// ActionUpdateUserPassword is the command that rewrites prospecta_user's
// password_hash. It is idempotent by command_id in the worker; here the hash is
// bcrypt-ed (or set for the first time by a Google-only user).
const ActionUpdateUserPassword = "UpdateUserPassword"

// Service holds the signup/login use cases. It depends only on the application
// ports (the domain pair doors), never on a database. google is the SSO door:
// nil when no client ID is configured, which makes /auth/google answer 503.
type Service struct {
	publisher application.CommandPublisher
	users     application.UserReader
	companies application.CompanyReader
	sessions  *Manager
	google    GoogleVerifier
	log       *slog.Logger
}

func NewService(publisher application.CommandPublisher, users application.UserReader, companies application.CompanyReader, sessions *Manager, google GoogleVerifier, log *slog.Logger) *Service {
	return &Service{publisher: publisher, users: users, companies: companies, sessions: sessions, google: google, log: log}
}

// Sessions exposes the cookie manager to the transport (middleware, logout).
func (s *Service) Sessions() *Manager {
	if s == nil || s.sessions == nil {
		return NewManager("", 0) // disabled
	}
	return s.sessions
}

// Enabled reports whether sessions can be minted; false makes /auth answer 503.
func (s *Service) Enabled() bool { return s.Sessions().Enabled() }

// UserView and CompanyView are the wire shapes the contract fixes for the
// {user, company} body returned by signup/login/me.
type UserView struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
}

type CompanyView struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type SessionResponse struct {
	User    UserView    `json:"user"`
	Company CompanyView `json:"company"`
}

// SignupInput is the POST /auth/signup body. The account is created either with
// e-mail+password or with a Google ID token (GoogleCredential): when the token
// is present the e-mail/name come from Google and no password is required.
type SignupInput struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
	// GoogleCredential é o ID token do Google Identity Services. Presente, o
	// cadastro ignora Name/Email/Password e usa a identidade verificada do
	// Google — sem senha (password_hash vai vazio; o usuário define depois via
	// POST /auth/password).
	GoogleCredential string `json:"google_credential"`
	Cargo            string `json:"cargo"`
	Phone            string `json:"phone"`
	Company          struct {
		Name        string `json:"name"`
		Site        string `json:"site"`
		Description string `json:"description"`
	} `json:"company"`
}

// Signup implements POST /auth/signup: validate -> reject duplicate -> publish
// CreateCompany under a fresh tenant -> publish CreateUser with the company's
// command id -> return the session (the transport sets the cookie).
//
// The response user.id is the CreateUser command id and company.id is the
// CreateCompany command id, per the frozen contract.
func (s *Service) Signup(ctx context.Context, in SignupInput) (Session, SessionResponse, error) {
	if !s.Enabled() {
		return Session{}, SessionResponse{}, ErrDisabled
	}
	// Cadastro por Google: a identidade (email/name) vem do token verificado e
	// não há senha. O token é checado ANTES de qualquer escrita — um token
	// inválido não publica comando nenhum.
	var passwordHash string
	hasPassword := true
	if strings.TrimSpace(in.GoogleCredential) != "" {
		hasPassword = false
		if s.google == nil {
			return Session{}, SessionResponse{}, ErrGoogleDisabled
		}
		identity, err := s.google.Verify(in.GoogleCredential)
		if err != nil {
			return Session{}, SessionResponse{}, err
		}
		in.Email, in.Name = identity.Email, identity.Name
		if in.Name == "" {
			in.Name = localPart(in.Email)
		}
	}

	in.Name = strings.TrimSpace(in.Name)
	in.Email = domain.NormalizeEmail(in.Email)
	in.Company.Name = strings.TrimSpace(in.Company.Name)

	if err := domain.ValidateSignup(in.Name, in.Email, in.Password, in.Company.Name, hasPassword); err != nil {
		return Session{}, SessionResponse{}, err
	}

	if hasPassword {
		hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
		if err != nil {
			return Session{}, SessionResponse{}, err
		}
		passwordHash = string(hash)
	}

	// Duplicate guard: a 200 from the pair means the e-mail already exists.
	// ErrNotFound is the green path; anything else is a downstream failure.
	if _, err := s.users.UserByEmail(ctx, in.Email); err == nil {
		return Session{}, SessionResponse{}, domain.ErrUserExists
	} else if !errors.Is(err, domain.ErrNotFound) {
		return Session{}, SessionResponse{}, err
	}

	tenantID := uuid.NewString()
	scoped := identity.WithTenant(ctx, tenantID)

	companyID, err := s.publisher.Publish(scoped, application.ActionCreateCompany, map[string]any{
		"name":        in.Company.Name,
		"site":        strings.TrimSpace(in.Company.Site),
		"description": strings.TrimSpace(in.Company.Description),
		"tenant_id":   tenantID,
	})
	if err != nil {
		return Session{}, SessionResponse{}, err
	}

	userID, err := s.publisher.Publish(scoped, ActionCreateUser, map[string]any{
		"tenant_id":     tenantID,
		"company_id":    companyID,
		"name":          in.Name,
		"email":         in.Email,
		"password_hash": passwordHash,
		"role":          "owner",
	})
	if err != nil {
		return Session{}, SessionResponse{}, err
	}

	session := Session{
		UserID:    userID,
		Email:     in.Email,
		Name:      in.Name,
		CompanyID: companyID,
		TenantID:  tenantID,
	}
	body := SessionResponse{
		User:    UserView{ID: userID, Email: in.Email, Name: in.Name},
		Company: CompanyView{ID: companyID, Name: in.Company.Name},
	}
	return session, body, nil
}

// Login validates the credentials against the hash the pair stores and returns
// the session. An unknown e-mail and a wrong password both yield
// ErrInvalidCredentials.
func (s *Service) Login(ctx context.Context, email, password string) (Session, SessionResponse, error) {
	if !s.Enabled() {
		return Session{}, SessionResponse{}, ErrDisabled
	}
	email = domain.NormalizeEmail(email)
	if email == "" || password == "" {
		return Session{}, SessionResponse{}, ErrInvalidCredentials
	}
	user, err := s.users.UserByEmail(ctx, email)
	if errors.Is(err, domain.ErrNotFound) {
		return Session{}, SessionResponse{}, ErrInvalidCredentials
	}
	if err != nil {
		return Session{}, SessionResponse{}, err
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) != nil {
		return Session{}, SessionResponse{}, ErrInvalidCredentials
	}

	return s.sessionFor(ctx, user), s.bodyFor(ctx, user), nil
}

// GoogleResponse is the POST /auth/google body. It is either a full session
// (Login=true, with an issued cookie) or the onboarding directive the SPA needs
// to finish the company signup (NeedsOnboarding=true, no cookie).
type GoogleResponse struct {
	User            UserView    `json:"user,omitempty"`
	Company         CompanyView `json:"company,omitempty"`
	NeedsOnboarding bool        `json:"needs_onboarding,omitempty"`
	Email           string      `json:"email,omitempty"`
	Name            string      `json:"name,omitempty"`
}

// GoogleLogin implements POST /auth/google. It verifies the ID token, looks the
// user up by e-mail and either mints a session (existing account) or answers the
// onboarding directive (unknown e-mail, no cookie). A missing client ID is
// ErrGoogleDisabled (503), never a token failure.
func (s *Service) GoogleLogin(ctx context.Context, credential string) (Session, GoogleResponse, bool, error) {
	if !s.Enabled() {
		return Session{}, GoogleResponse{}, false, ErrDisabled
	}
	if s.google == nil {
		return Session{}, GoogleResponse{}, false, ErrGoogleDisabled
	}
	identity, err := s.google.Verify(credential)
	if err != nil {
		return Session{}, GoogleResponse{}, false, err
	}
	user, err := s.users.UserByEmail(ctx, identity.Email)
	if errors.Is(err, domain.ErrNotFound) {
		// Sem conta ainda: o SPA completa o cadastro da empresa. Nada é emitido.
		name := identity.Name
		if name == "" {
			name = localPart(identity.Email)
		}
		return Session{}, GoogleResponse{NeedsOnboarding: true, Email: identity.Email, Name: name}, false, nil
	}
	if err != nil {
		return Session{}, GoogleResponse{}, false, err
	}
	sess := s.sessionFor(ctx, user)
	return sess, GoogleResponse{User: UserView{ID: user.ID, Email: user.Email, Name: user.Name}, Company: s.bodyFor(ctx, user).Company}, true, nil
}

// PasswordInput is the POST /auth/password body.
type PasswordInput struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

// ChangePassword implements POST /auth/password. It loads the caller's account
// (by the session's e-mail), verifies the current password, and publishes
// UpdateUserPassword with a fresh bcrypt hash. A user who only ever signed in
// with Google has no password: current_password must be empty and the first
// password is simply set. A wrong current password is ErrInvalidCredentials;
// a too-short new one is domain.ErrUserPasswordWeak (422).
func (s *Service) ChangePassword(ctx context.Context, session Session, in PasswordInput) error {
	if !s.Enabled() {
		return ErrDisabled
	}
	if len([]rune(in.NewPassword)) < domain.MinPasswordLength {
		return domain.ErrUserPasswordWeak
	}
	user, err := s.users.UserByEmail(ctx, session.Email)
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return ErrInvalidCredentials
	case err != nil:
		return err
	}
	// A conta só-Google tem password_hash vazio: não há senha atual a conferir,
	// e current_password precisa vir vazio para a DEFINIÇÃO ser aceita.
	if user.PasswordHash != "" {
		if in.CurrentPassword == "" ||
			bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(in.CurrentPassword)) != nil {
			return ErrInvalidCredentials
		}
	} else if in.CurrentPassword != "" {
		return ErrInvalidCredentials
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(in.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	// Escrita no tenant do usuário: o worker é o único dono da linha, e o
	// comando carrega o tenant_id da sessão.
	scoped := identity.WithTenant(ctx, user.TenantID)
	_, err = s.publisher.Publish(scoped, ActionUpdateUserPassword, map[string]any{
		"tenant_id":     user.TenantID,
		"user_id":       user.ID,
		"password_hash": string(hash),
	})
	return err
}

// sessionFor projects a stored user into the cookie claim set.
func (s *Service) sessionFor(_ context.Context, user domain.User) Session {
	return Session{
		UserID:    user.ID,
		Email:     user.Email,
		Name:      user.Name,
		CompanyID: user.CompanyID,
		TenantID:  user.TenantID,
	}
}

// bodyFor builds the {user, company} response. The company name is best-effort:
// the read is scoped to the user's tenant and a failure leaves the name empty
// instead of turning a valid login into an error.
func (s *Service) bodyFor(ctx context.Context, user domain.User) SessionResponse {
	companyName := ""
	if user.CompanyID != "" {
		scoped := identity.WithTenant(ctx, user.TenantID)
		if company, err := s.companies.Company(scoped, user.CompanyID); err == nil {
			companyName = company.Name
		} else {
			s.log.WarnContext(ctx, "company read failed; returning without name", "error", err)
		}
	}
	return SessionResponse{
		User:    UserView{ID: user.ID, Email: user.Email, Name: user.Name},
		Company: CompanyView{ID: user.CompanyID, Name: companyName},
	}
}

// localPart is the display-name fallback when the identity has no name.
func localPart(email string) string {
	if local, _, ok := strings.Cut(email, "@"); ok {
		return local
	}
	return email
}

// Me projects an existing session into the {user, company} body. The company
// name is read best-effort (scoped to the session's tenant); a failed read
// leaves it empty rather than failing the probe.
func (s *Service) Me(ctx context.Context, session Session) SessionResponse {
	companyName := ""
	if session.CompanyID != "" {
		scoped := identity.WithTenant(ctx, session.TenantID)
		if company, err := s.companies.Company(scoped, session.CompanyID); err == nil {
			companyName = company.Name
		}
	}
	return SessionResponse{
		User:    UserView{ID: session.UserID, Email: session.Email, Name: session.Name},
		Company: CompanyView{ID: session.CompanyID, Name: companyName},
	}
}
