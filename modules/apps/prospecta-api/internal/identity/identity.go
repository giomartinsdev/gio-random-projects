// Package identity carries who is making a request through the request context.
//
// It is a leaf package on purpose: the transport layer writes the identity
// (from the session cookie or the operator X-API-Key), and the infrastructure
// layer reads it (to scope every domain-pair call to the tenant the caller
// belongs to). If the context key lived in either of those, one would have to
// import the other and the dependency would cycle.
package identity

import "context"

// Identity is the resolved caller. An end-user session fills every field; the
// operator path (X-API-Key) fills only TenantID and sets Operator.
type Identity struct {
	UserID    string
	Email     string
	Name      string
	CompanyID string
	TenantID  string
	// Operator is true when the request came in through the fixed-tenant
	// X-API-Key door rather than an end-user session.
	Operator bool
}

type contextKey struct{}

// With returns a copy of ctx carrying id. The transport middleware is the only
// writer in production; tests may use it directly to stand in for a logged-in
// request.
func With(ctx context.Context, id Identity) context.Context {
	return context.WithValue(ctx, contextKey{}, id)
}

// WithTenant scopes ctx to a tenant without a full identity. The signup flow
// uses it to publish the first two commands under the freshly generated tenant
// before any session exists.
func WithTenant(ctx context.Context, tenantID string) context.Context {
	return With(ctx, Identity{TenantID: tenantID})
}

// From reads the identity the middleware (or a test) put in ctx.
func From(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(contextKey{}).(Identity)
	return id, ok
}

// TenantID returns the tenant the request is scoped to, or "" when no identity
// was resolved. The infrastructure falls back to its configured tenant in that
// case, so the operator flow keeps working.
func TenantID(ctx context.Context) string {
	if id, ok := From(ctx); ok {
		return id.TenantID
	}
	return ""
}
