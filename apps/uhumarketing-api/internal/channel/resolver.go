// Package channel resolve o WhatsApp de CADA conta.
//
// O serviço não tem WABA global: o token é do workspace. Se fosse do processo,
// a conta de um cliente mandaria mensagem pelo número de outro — e a cobrança,
// o opt-out e o banimento cairiam no dono errado.
package channel

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/domain"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/meta"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/secret"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/store"
)

// ErrNotActivated explica que falta ativar o canal. Vira 422 com o caminho
// ("Configurações → Ativar WhatsApp"), não um 500 nem uma mensagem simulada.
var ErrNotActivated = errors.New(
	"esta conta ainda não ativou o canal do WhatsApp: abra Configurações → WhatsApp e conecte o número da sua empresa")

// Resolver monta o provedor a partir do canal gravado.
type Resolver struct {
	Store *store.Store
	Box   *secret.Box
	// Mode é o modo do PROCESSO: `dry-run` mantém tudo simulado para
	// desenvolvimento; `live` exige canal por conta.
	Mode     string
	BaseURL  string
	Version  string
	Fallback meta.Provider
	// HTTP permite apontar para uma Graph de teste. Em produção fica nil.
	HTTP *http.Client
}

func (r *Resolver) globalLive() bool { return strings.EqualFold(r.Mode, "live") }

// Live diz se o processo está configurado para envio real. A tela usa isso para
// distinguir "dry-run de desenvolvimento" de "live, mas esta conta não ativou".
func (r *Resolver) Live() bool { return r.globalLive() }

// ProviderFor devolve o provedor da conta.
//
// Regra: canal ativo manda. Sem canal, `dry-run` global ainda simula (é o modo
// de desenvolvimento); `live` global recusa — não existe envio "no canal de
// ninguém".
func (r *Resolver) ProviderFor(ctx context.Context, workspaceID string) (meta.Provider, error) {
	c, err := r.Store.Channel(ctx, workspaceID)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return nil, err
	}
	if err == nil && c.Active() {
		return r.providerFor(c)
	}
	if !r.globalLive() {
		if r.Fallback != nil {
			return r.Fallback, nil
		}
		return &meta.DryRunProvider{}, nil
	}
	return nil, ErrNotActivated
}

// CanSend diz se a conta tem canal utilizável. O worker usa isso para não
// drenar fila de conta sem canal: tentar enviar produziria falha em laço.
func (r *Resolver) CanSend(ctx context.Context, workspaceID string) bool {
	return r.CanSendErr(ctx, workspaceID) == nil
}

func (r *Resolver) CanSendErr(ctx context.Context, workspaceID string) error {
	c, err := r.Store.Channel(ctx, workspaceID)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return err
	}
	if err == nil && c.Active() {
		return nil
	}
	if !r.globalLive() {
		return nil
	}
	return ErrNotActivated
}

func (r *Resolver) providerFor(c store.Channel) (meta.Provider, error) {
	if !c.Live() {
		// Canal ativado em dry-run continua simulado mesmo se o processo subir
		// em live: virar envio real por mudança de configuração seria o pior
		// acidente possível.
		return &meta.DryRunProvider{}, nil
	}
	if r.Box == nil {
		return nil, fmt.Errorf("CHANNEL_SECRET não configurado: sem ele não há como ler o token do canal")
	}
	token, err := r.Box.Open(c.TokenCipher)
	if err != nil {
		return nil, err
	}
	return r.cloud(c.WABAID, c.PhoneID, token), nil
}

// Credentials são as três informações que a Meta dá ao conectar um número.
type Credentials struct {
	WABAID  string
	PhoneID string
	Token   string
}

// Verify pergunta à Graph se as credenciais respondem. Ativar sem verificar
// gravaria um canal que parece conectado e falha no primeiro envio — pior do
// que recusar na hora, com o motivo.
func (r *Resolver) Verify(ctx context.Context, c Credentials) (meta.ChannelInfo, error) {
	info, err := r.cloud(c.WABAID, c.PhoneID, c.Token).Check(ctx)
	if err != nil {
		return meta.ChannelInfo{}, err
	}
	info.OK = true
	return info, nil
}

// cloud monta o CloudProvider de um canal já conhecido. Único ponto que decide
// base/versão, para teste e produção não divergirem.
func (r *Resolver) cloud(wabaID, phoneID, token string) *meta.CloudProvider {
	version := r.Version
	if version == "" {
		version = "v21.0"
	}
	base := r.BaseURL
	if base == "" {
		base = "https://graph.facebook.com"
	}
	return &meta.CloudProvider{
		BaseURL:       base,
		APIVersion:    version,
		WABAID:        wabaID,
		PhoneNumberID: phoneID,
		Token:         token,
		HTTP:          r.HTTP,
	}
}

// Seal cifra o token antes de gravar. Sem chave, recusa: gravar em claro
// "para funcionar" entregaria a conta do cliente a quem lesse um dump.
func (r *Resolver) Seal(token string) (string, error) {
	if r.Box == nil {
		return "", secret.ErrNoKey
	}
	return r.Box.Seal(token)
}
