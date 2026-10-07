package domain

import "errors"

// Validation errors for the Campaign/Lead/Conversation slices. Like the
// company ones they map to 422: the request is well-formed but semantically
// invalid and no command was published, so there is never a partial write.
var (
	ErrCampaignCompanyRequired = errors.New("campaign company_id is required")
	ErrCampaignNameRequired    = errors.New("campaign name is required")
	ErrCampaignICPRequired     = errors.New("campaign must have an ICP before it can start")
	ErrCampaignIDRequired      = errors.New("campaign id is required")
	ErrLeadIDRequired          = errors.New("lead id is required")
	ErrFitOutOfRange           = errors.New("fit must be between 0 and 100")
	ErrMessageContentRequired  = errors.New("message content is required")
	ErrMessageLeadRequired     = errors.New("message lead_id is required")
	ErrMessageChannelRequired  = errors.New("message channel is required")
	ErrCampaignRequired        = errors.New("campaign_id is required")
	ErrDomainRequired          = errors.New("domain is required")
	ErrRunIDRequired           = errors.New("run id is required")
	ErrInvalidRunState         = errors.New("run state must be running, done or failed")
)

// ErrMessageNotDrafted is what ApproveMessage returns when the message is not
// in "drafted"; the transport maps it to 409 (state conflict, not a bad body).
var ErrMessageNotDrafted = errors.New("message is not in drafted state")
