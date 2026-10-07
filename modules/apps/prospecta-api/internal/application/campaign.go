package application

import (
	"context"
	"strings"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/domain"
)

// CreateCampaignInput is the POST /campaigns body. icp_id is derived by the
// pair from company_id when omitted; company_id and name are required.
type CreateCampaignInput struct {
	CompanyID string   `json:"company_id"`
	ICPID     string   `json:"icp_id"`
	Name      string   `json:"name"`
	Channels  []string `json:"channels"`
}

// CampaignService is the use-case layer for campaigns.
type CampaignService struct {
	publisher CommandPublisher
	reader    CampaignReader
}

func NewCampaignService(publisher CommandPublisher, reader CampaignReader) *CampaignService {
	return &CampaignService{publisher: publisher, reader: reader}
}

// CreateCampaign validates the input and publishes CreateCampaign. An invalid
// company or empty name is rejected before publishing (no partial write).
func (s *CampaignService) CreateCampaign(ctx context.Context, in CreateCampaignInput) (string, error) {
	in.CompanyID = strings.TrimSpace(in.CompanyID)
	if in.CompanyID == "" {
		return "", domain.ErrCampaignCompanyRequired
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return "", domain.ErrCampaignNameRequired
	}
	channels := in.Channels
	if channels == nil {
		channels = []string{}
	}
	payload := map[string]any{
		"company_id": in.CompanyID,
		"name":       in.Name,
		"channels":   channels,
	}
	if icpID := strings.TrimSpace(in.ICPID); icpID != "" {
		payload["icp_id"] = icpID
	}
	return s.publisher.Publish(ctx, ActionCreateCampaign, payload)
}

// StartCampaign publishes the two commands the contract names as one action:
// StartCampaign flips the campaign to running, RequestProspect opens the agent
// run. Both are sent once the campaign is known to have an ICP.
func (s *CampaignService) StartCampaign(ctx context.Context, campaignID string) (string, error) {
	campaignID = strings.TrimSpace(campaignID)
	if campaignID == "" {
		return "", domain.ErrCampaignIDRequired
	}
	campaign, err := s.reader.Campaign(ctx, campaignID)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(campaign.ICPID) == "" {
		return "", domain.ErrCampaignICPRequired
	}
	id, err := s.publisher.Publish(ctx, ActionStartCampaign, map[string]any{"campaign_id": campaignID})
	if err != nil {
		return "", err
	}
	if _, err := s.publisher.Publish(ctx, ActionRequestProspect, map[string]any{"campaign_id": campaignID}); err != nil {
		return "", err
	}
	return id, nil
}

// GetCampaign reads one campaign projection; a missing record is ErrNotFound.
func (s *CampaignService) GetCampaign(ctx context.Context, id string) (domain.Campaign, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return domain.Campaign{}, domain.ErrNotFound
	}
	return s.reader.Campaign(ctx, id)
}

// ListCampaigns reads a page of campaigns.
func (s *CampaignService) ListCampaigns(ctx context.Context, limit int, cursor string) (domain.Page[domain.Campaign], error) {
	return s.reader.ListCampaigns(ctx, normalizeLimit(limit), strings.TrimSpace(cursor))
}

func normalizeLimit(limit int) int {
	if limit <= 0 {
		return 20
	}
	if limit > 100 {
		return 100
	}
	return limit
}
