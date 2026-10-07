package prospecta

import (
	"errors"
	"time"
)

// Erros do agregado Campaign. Os comuns (tenant, company, name) são
// reaproveitados de company.go para não duplicar a mensagem.
var (
	ErrCampaignIDRequired = errors.New("campaign_id is required")
	ErrICPIDRequired      = errors.New("icp_id is required")
	ErrNoICP              = errors.New("campaign requires an icp before starting")
	ErrCampaignNotDraft   = errors.New("campaign can only be started from draft")
)

// CampaignStatus é o ciclo de vida da campanha (data-model §3).
type CampaignStatus string

const (
	CampaignDraft   CampaignStatus = "draft"
	CampaignRunning CampaignStatus = "running"
	CampaignPaused  CampaignStatus = "paused"
	CampaignDone    CampaignStatus = "done"
)

// Campaign agrupa um ICP e o conjunto de leads que os agentes vão prospectar.
// Nasce sempre em draft (§4.1 do spec: criação e disparo são comandos
// separados — a API responde 202 no CreateCampaign e só o StartCampaign liga
// os agentes).
type Campaign struct {
	ID             string
	TenantID       string
	CompanyID      string
	ICPID          string
	Name           string
	Channels       []string
	Status         CampaignStatus
	ApprovalPolicy string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// NewCampaign valida os invariantes de criação: pertence a um tenant, a uma
// empresa, tem nome. O ICP pode ainda não existir no CreateCampaign (o
// data-model o torna obrigatório apenas para run); StartCampaign é quem exige.
// O status inicial é sempre draft e o approval policy default é "human" (D10).
func NewCampaign(id, tenantID, companyID, icpID, name string, channels []string, approvalPolicy string) (Campaign, error) {
	if tenantID == "" {
		return Campaign{}, ErrTenantIDRequired
	}
	if companyID == "" {
		return Campaign{}, ErrCompanyIDRequired
	}
	if name == "" {
		return Campaign{}, ErrNameRequired
	}
	if channels == nil {
		channels = []string{}
	}
	if approvalPolicy == "" {
		approvalPolicy = "human"
	}
	return Campaign{
		ID:             id,
		TenantID:       tenantID,
		CompanyID:      companyID,
		ICPID:          icpID,
		Name:           name,
		Channels:       channels,
		Status:         CampaignDraft,
		ApprovalPolicy: approvalPolicy,
	}, nil
}

// Start liga a campanha. Só a partir de draft; e a partir daí precisa de ICP
// (sem ICP não qualifica nada). Devolve a cópia com status=running.
func (c Campaign) Start() (Campaign, error) {
	if c.ICPID == "" {
		return c, ErrNoICP
	}
	if c.Status != CampaignDraft {
		return c, ErrCampaignNotDraft
	}
	next := c
	next.Status = CampaignRunning
	return next, nil
}
