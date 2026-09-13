// Package fundamentus fetches a ticker's dividend/provento history from
// fundamentus.com.br's public "proventos" page -- no token, no
// registration, unlike brapi.dev's dividendsData module which is a paid
// tier feature this project doesn't have. The page is plain server-
// rendered HTML (no JS needed to see the data), parsed with
// golang.org/x/net/html rather than a third-party scraping framework,
// consistent with this repo's stdlib-first bias.
package fundamentus

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/html"
)

// baseURL is a var, not a const, so tests can point it at an
// httptest.Server instead of the real site.
var baseURL = "https://www.fundamentus.com.br/proventos.php"

// Dividend is one row of the "proventos" table -- DataPagamento is the
// field that matters for crediting: it is when the cash actually lands,
// not the ex-date ("Data" column, when the right to receive it locks
// in). ValorPorAcao is the gross value fundamentus shows; this
// deliberately does NOT account for IR withholding on "JRS CAP
// PROPRIO" (juros sobre capital próprio) -- a documented simplification
// for v1, not an oversight.
type Dividend struct {
	DataPagamento time.Time
	ValorPorAcao  float64
	Tipo          string
}

// Client fetches and parses fundamentus.com.br's proventos page.
type Client struct {
	http *http.Client
}

func New() *Client {
	return &Client{http: &http.Client{Timeout: 15 * time.Second}}
}

// FetchDividends returns every dividend event fundamentus has on record
// for ticker, oldest and newest alike -- callers are expected to filter
// down to what they haven't processed yet (there is no date-range
// param on this page).
func (c *Client) FetchDividends(ctx context.Context, ticker string) ([]Dividend, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"?papel="+ticker+"&tipo=2", nil)
	if err != nil {
		return nil, fmt.Errorf("fundamentus: build request: %w", err)
	}
	// fundamentus 403s a client with no User-Agent at all.
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; proventos-worker/1.0)")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fundamentus: GET %s: %w", ticker, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fundamentus: GET %s: status %d", ticker, resp.StatusCode)
	}

	doc, err := html.Parse(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, fmt.Errorf("fundamentus: parse %s response: %w", ticker, err)
	}
	table := findByIDAndTag(doc, "resultado", "table")
	if table == nil {
		// No "resultado" table means fundamentus has nothing on this
		// ticker (or changed markup) -- an empty result, not an error,
		// so one bad ticker never aborts the whole cycle.
		return nil, nil
	}
	return parseRows(table), nil
}

func parseRows(table *html.Node) []Dividend {
	var out []Dividend
	for _, row := range findAll(table, "tr") {
		cells := findAll(row, "td")
		if len(cells) < 4 {
			continue // header row (th, not td) or a malformed one
		}
		valor, err := parseValorBR(textOf(cells[1]))
		if err != nil {
			continue
		}
		pagamento, err := time.Parse("02/01/2006", strings.TrimSpace(textOf(cells[3])))
		if err != nil {
			// Announced but not yet paid rows leave this column blank
			// (or "-") -- skip them, there is nothing to credit yet.
			continue
		}
		out = append(out, Dividend{
			DataPagamento: pagamento,
			ValorPorAcao:  valor,
			Tipo:          strings.TrimSpace(textOf(cells[2])),
		})
	}
	return out
}

// parseValorBR turns "0,4716" into 0.4716.
func parseValorBR(raw string) (float64, error) {
	raw = strings.TrimSpace(raw)
	raw = strings.ReplaceAll(raw, ".", "")
	raw = strings.ReplaceAll(raw, ",", ".")
	return strconv.ParseFloat(raw, 64)
}

func textOf(n *html.Node) string {
	var sb strings.Builder
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.TextNode {
			sb.WriteString(n.Data)
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return sb.String()
}

func attr(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if a.Key == key {
			return a.Val
		}
	}
	return ""
}

func findByIDAndTag(n *html.Node, id, tag string) *html.Node {
	if n.Type == html.ElementNode && n.Data == tag && attr(n, "id") == id {
		return n
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if found := findByIDAndTag(c, id, tag); found != nil {
			return found
		}
	}
	return nil
}

func findAll(n *html.Node, tag string) []*html.Node {
	var out []*html.Node
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == tag {
			out = append(out, n)
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return out
}
