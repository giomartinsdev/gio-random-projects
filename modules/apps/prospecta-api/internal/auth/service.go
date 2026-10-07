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
// hashes nothing: password_hash arrives already bcrypt-ed from here.
const ActionCreateUser = "CreateUser"

// Service holds the signup/login use cases. It depends only on the application
// ports (the domain pair doors), never on a database.
type Service struct {
	publisher application.CommandPublisher
	users     application.UserReader
	companies application.CompanyReader
	sessions  *Manager
	log       *slog.Logger
}

func NewService(publisher application.CommandPublisher, users application.UserReader, companies application.CompanyReader, sessions *Manager, log *slog.Logger) *Service {
	return &Service{publisher: publisher, users: users, companies: companies, sessions: sessions, log: log}
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

// SignupInput is the POST /auth/signup body.
type SignupInput struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
	Cargo    string `json:"cargo"`
	Phone    string `json:"phone"`
	Company  struct {
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
	in.Name = strings.TrimSpace(in.Name)
	in.Email = domain.NormalizeEmail(in.Email)
	in.Company.Name = strings.TrimSpace(in.Company.Name)

	if err := domain.ValidateSignup(in.Name, in.Email, in.Password, in.Company.Name); err != nil {
		return Session{}, SessionResponse{}, err
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

	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		return Session{}, SessionResponse{}, err
	}

	userID, err := s.publisher.Publish(scoped, ActionCreateUser, map[string]any{
		"tenant_id":     tenantID,
		"company_id":    companyID,
		"name":          in.Name,
		"email":         in.Email,
		"password_hash": string(hash),
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

	tenantID := user.TenantID
	session := Session{
		UserID:    user.ID,
		Email:     user.Email,
		Name:      user.Name,
		CompanyID: user.CompanyID,
		TenantID:  tenantID,
	}
	// Best effort: the company name is decoration; a failed read must not turn
	// a valid login into an error. The read is scoped to the user's tenant.
	companyName := ""
	if user.CompanyID != "" {
		scoped := identity.WithTenant(ctx, tenantID)
		if company, err := s.companies.Company(scoped, user.CompanyID); err == nil {
			companyName = company.Name
		} else {
			s.log.WarnContext(ctx, "company read on login failed; returning session without name", "error", err)
		}
	}
	body := SessionResponse{
		User:    UserView{ID: user.ID, Email: user.Email, Name: user.Name},
		Company: CompanyView{ID: user.CompanyID, Name: companyName},
	}
	return session, body, nil
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
