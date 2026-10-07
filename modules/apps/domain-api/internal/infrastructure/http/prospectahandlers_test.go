package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	domainprospecta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/prospecta"
)

// stubProspectaReads devolve uma projeção canônica (ou erro) por tenant.
type stubProspectaReads struct {
	company domainprospecta.CompanyView
	icp     domainprospecta.ICPView
	err     error
}

func (s *stubProspectaReads) GetCompany(context.Context, string, string) (domainprospecta.CompanyView, error) {
	return s.company, s.err
}

func (s *stubProspectaReads) ICPByCompany(context.Context, string, string) (domainprospecta.ICPView, error) {
	return s.icp, s.err
}

func (s *stubProspectaReads) ListCampaigns(context.Context, string, int, string) (domainprospecta.Page[domainprospecta.CampaignView], error) {
	return domainprospecta.Page[domainprospecta.CampaignView]{}, s.err
}

func (s *stubProspectaReads) GetCampaign(context.Context, string, string) (domainprospecta.CampaignView, error) {
	return domainprospecta.CampaignView{}, s.err
}

func (s *stubProspectaReads) ListLeads(context.Context, string, domainprospecta.LeadFilter, int, string) (domainprospecta.Page[domainprospecta.LeadView], error) {
	return domainprospecta.Page[domainprospecta.LeadView]{}, s.err
}

func (s *stubProspectaReads) GetLead(context.Context, string, string) (domainprospecta.LeadView, error) {
	return domainprospecta.LeadView{}, s.err
}

func (s *stubProspectaReads) ListConversations(context.Context, string, int, string) (domainprospecta.Page[domainprospecta.ConversationView], error) {
	return domainprospecta.Page[domainprospecta.ConversationView]{}, s.err
}

func (s *stubProspectaReads) GetConversation(context.Context, string, string) (domainprospecta.ConversationView, error) {
	return domainprospecta.ConversationView{}, s.err
}

func (s *stubProspectaReads) GetMessage(context.Context, string, string) (domainprospecta.MessageView, error) {
	return domainprospecta.MessageView{}, s.err
}

func (s *stubProspectaReads) ListActivity(context.Context, string, int) ([]domainprospecta.AgentRunEvent, error) {
	return nil, s.err
}

func prospectaServer(reads domainprospecta.ReadRepository, pub *spyPublisher) http.Handler {
	h := NewProspectaHandlers(reads, pub, discardLogger())
	r := chi.NewRouter()
	r.Post("/companies", h.CreateCompany)
	r.Get("/companies/{id}", h.GetCompany)
	r.Post("/companies/{companyId}/icp", h.DefineICP)
	return r
}

func postProspecta(t *testing.T, h http.Handler, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestProspectaCreateCompanyPublishes202(t *testing.T) {
	pub := &spyPublisher{}
	rec := postProspecta(t, prospectaServer(nil, pub), "/companies",
		`{"tenant_id":"11111111-1111-1111-1111-111111111111","name":"ACME","site":"acme.com"}`)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d; want 202", rec.Code)
	}
	if string(pub.cmd.Action) != "CreateCompany" {
		t.Fatalf("action = %q; want CreateCompany", pub.cmd.Action)
	}
	if pub.calls != 1 {
		t.Fatalf("publishes = %d; want 1", pub.calls)
	}
}

func TestProspectaCreateCompanyRequiresNameAndTenant(t *testing.T) {
	for name, body := range map[string]string{
		"sem nome":   `{"tenant_id":"t"}`,
		"sem tenant": `{"name":"ACME"}`,
		"json ruim":  `{`,
	} {
		pub := &spyPublisher{}
		rec := postProspecta(t, prospectaServer(nil, pub), "/companies", body)
		if rec.Code != http.StatusUnprocessableEntity && rec.Code != http.StatusBadRequest {
			t.Errorf("%s = %d; want 422/400", name, rec.Code)
		}
		if pub.calls != 0 {
			t.Errorf("%s publicou %d; want 0", name, pub.calls)
		}
	}
}

func TestProspectaDefineICPTakesPathCompanyID(t *testing.T) {
	pub := &spyPublisher{}
	rec := postProspecta(t, prospectaServer(nil, pub), "/companies/22222222-2222-2222-2222-222222222222/icp",
		`{"tenant_id":"33333333-3333-3333-3333-333333333333","definition":"transportadoras","signals":["frota"]}`)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d; want 202", rec.Code)
	}
	if string(pub.cmd.Action) != "DefineICP" {
		t.Fatalf("action = %q; want DefineICP", pub.cmd.Action)
	}
	// O company_id do caminho entra no payload (o do corpo seria ignorado).
	var in struct {
		CompanyID string `json:"company_id"`
	}
	if err := json.Unmarshal(pub.cmd.Payload, &in); err != nil {
		t.Fatalf("payload: %v", err)
	}
	if in.CompanyID != "22222222-2222-2222-2222-222222222222" {
		t.Fatalf("company_id = %q; want o do caminho", in.CompanyID)
	}
}

func TestProspectaGetCompanyProjectionAnd404(t *testing.T) {
	reads := &stubProspectaReads{company: domainprospecta.CompanyView{
		ID: "abc", TenantID: "t", Name: "ACME", Site: "acme.com", CreatedAt: "2026-10-07T00:00:00Z",
	}}
	h := prospectaServer(reads, &spyPublisher{})
	req := httptest.NewRequest(http.MethodGet, "/companies/abc?tenant_id=t", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200", rec.Code)
	}
	var got domainprospecta.CompanyView
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("body: %v", err)
	}
	if got.Name != "ACME" {
		t.Fatalf("name = %q; want ACME", got.Name)
	}

	// tenant_id obrigatório.
	req = httptest.NewRequest(http.MethodGet, "/companies/abc", nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("sem tenant = %d; want 400", rec.Code)
	}

	// inexistente -> 404.
	nf := prospectaServer(&stubProspectaReads{err: domainprospecta.ErrNotFound}, &spyPublisher{})
	req = httptest.NewRequest(http.MethodGet, "/companies/abc?tenant_id=t", nil)
	rec = httptest.NewRecorder()
	nf.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("inexistente = %d; want 404", rec.Code)
	}
}
