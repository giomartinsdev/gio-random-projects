package httpapi

import (
	"bytes"
	"fmt"
	"hash/fnv"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
	"strings"

	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

// Cartão de preview (og:image): o escudo do clube + nome + campanha, num PNG.
//
// Por que PNG e não SVG: o cartão do Discord/WhatsApp/X é buscado por um bot
// que NÃO renderiza SVG -- servir um SVG daria cartão sem imagem. Então o escudo
// que o SPA desenha em SVG é redesenhado aqui, no servidor, como bitmap.
//
// Sem dependência de imagem externa: a fonte é o "Go Bold" EMBUTIDO em
// golang.org/x/image (uma TTF no binário), então não há arquivo de fonte para
// versionar nem caminho para quebrar no container distroless (que não tem
// fontes de sistema).
//
// O cartão replica a paleta do front (lib/crest.ts): a forma e as cores saem de
// um hash estável do clube, para o MESMO clube desenhar o mesmo escudo na tela e
// no cartão. Duplicar a regra é deliberado -- o front e o back são processos
// separados, e a alternativa (o back chamar o front) seria pior. Se a regra
// mudar, muda nos dois.

const (
	cardW = 1200
	cardH = 630
)

// Cores do tema escuro do hub (o cartão é sempre escuro: ele aparece em fundo
// claro E escuro, e o escuro é o que o hub usa como padrão).
var (
	cardBg      = color.RGBA{0x0b, 0x0d, 0x0f, 0xff}
	cardFg      = color.RGBA{0xf2, 0xf4, 0xf6, 0xff}
	cardMuted   = color.RGBA{0x9a, 0xa3, 0xad, 0xff}
	cardAccent  = color.RGBA{0x4d, 0xa3, 0xff, 0xff}
	cardWin     = color.RGBA{0x2c, 0xe5, 0x9a, 0xff}
	cardDrawCol = color.RGBA{0xf2, 0xf4, 0xf6, 0xff}
	cardLossCol = color.RGBA{0xff, 0x5d, 0x6c, 0xff}
)

// hash32 replica o FNV-1a do front (lib/crest.ts) -- a mesma seed tem que dar a
// mesma paleta nos dois lados.
func hash32(s string) uint32 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(s))
	return h.Sum32()
}

// clubColors deriva duas cores de um id estável, no mesmo espírito do front:
// matiz do hash, saturação e luz fixas para o contraste com o texto branco.
func clubColors(seed string) (base, detail color.RGBA) {
	h := hash32(seed)
	hue := float64(h%360) / 360.0
	baseH, detailH := hue, math.Mod(hue+0.08, 1)
	base = hslToRGB(baseH, 0.55, 0.42)
	detail = hslToRGB(detailH, 0.6, 0.28)
	return base, detail
}

func hslToRGB(h, s, l float64) color.RGBA {
	if s == 0 {
		v := uint8(l * 255)
		return color.RGBA{v, v, v, 0xff}
	}
	var q float64
	if l < 0.5 {
		q = l * (1 + s)
	} else {
		q = l + s - l*s
	}
	p := 2*l - q
	r := hue2rgb(p, q, h+1.0/3)
	g := hue2rgb(p, q, h)
	b := hue2rgb(p, q, h-1.0/3)
	return color.RGBA{uint8(r * 255), uint8(g * 255), uint8(b * 255), 0xff}
}

func hue2rgb(p, q, t float64) float64 {
	if t < 0 {
		t++
	}
	if t > 1 {
		t--
	}
	switch {
	case t < 1.0/6:
		return p + (q-p)*6*t
	case t < 1.0/2:
		return q
	case t < 2.0/3:
		return p + (q-p)*(2.0/3-t)*6
	default:
		return p
	}
}

// drawCard compõe o PNG. Tudo desenhado à mão sobre um image.RGBA -- sem
// biblioteca de layout, porque o cartão tem posições fixas e um layout engine
// só acrescentaria dependência e imprevisibilidade.
func drawCard(name, tag string, division, played, wins, draws, losses int) ([]byte, error) {
	img := image.NewRGBA(image.Rect(0, 0, cardW, cardH))
	draw.Draw(img, img.Bounds(), &image.Uniform{cardBg}, image.Point{}, draw.Src)

	base, detail := clubColors(name + tag)

	// Escudo à esquerda: uma forma simples (retângulo com cantos arredondados
	// no topo) preenchida com a cor do clube e a sigla dentro.
	shieldX, shieldY := 90, 180
	shieldW, shieldH := 240, 280
	drawShield(img, shieldX, shieldY, shieldW, shieldH, base, detail, tag)

	face, err := cardFont(64)
	if err != nil {
		return nil, err
	}
	small, err := cardFont(34)
	if err != nil {
		return nil, err
	}
	tiny, err := cardFont(26)
	if err != nil {
		return nil, err
	}

	textX := shieldX + shieldW + 70
	drawString(img, face, cardFg, textX, 250, truncate(name, 20))
	if division > 0 {
		drawString(img, small, cardAccent, textX, 310, fmt.Sprintf("Divisão %d", division))
	}
	drawString(img, small, cardMuted, textX, 370,
		fmt.Sprintf("%d jogos · %dV %dE %dD", played, wins, draws, losses))

	// Rodapé: a marca do hub, para o cartão se identificar em qualquer canal.
	drawString(img, tiny, cardMuted, shieldX, cardH-70, "FC Clubs Hub")
	drawString(img, tiny, cardMuted, shieldX, cardH-40, "clubs.giomartins.dev")

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, fmt.Errorf("encode png: %w", err)
	}
	return buf.Bytes(), nil
}

// drawShield desenha o escudo: corpo arredondado, uma faixa diagonal na cor de
// detalhe e a sigla centralizada. Não é o SVG do front pixel a pixel -- é a
// mesma IDEIA (forma + cor do clube + sigla), que é o que o cartão precisa.
func drawShield(img *image.RGBA, x, y, w, h int, base, detail color.RGBA, tag string) {
	// Corpo: retângulo com a base em ponta (como um escudo).
	body := make([]image.Point, 0, 2*(w+h))
	// Topo arredondado, lados retos, base em V.
	body = append(body,
		image.Pt(x, y+30), image.Pt(x+30, y), image.Pt(x+w-30, y), image.Pt(x+w, y+30),
		image.Pt(x+w, y+h-90), image.Pt(x+w/2, y+h), image.Pt(x, y+h-90),
	)
	fillPolygon(img, body, base)

	// Faixa diagonal na cor de detalhe.
	stripe := []image.Point{
		image.Pt(x+w/2-30, y), image.Pt(x+w/2+10, y),
		image.Pt(x+w/2-90, y+h), image.Pt(x+w/2-130, y+h),
	}
	fillPolygon(img, stripe, detail)

	// Borda.
	strokePolygon(img, body, detail)

	// Sigla centralizada, em branco.
	if tag != "" {
		if f, err := cardFont(72); err == nil {
			tw := font.MeasureString(f, tag).Round()
			drawString(img, f, color.RGBA{0xff, 0xff, 0xff, 0xff}, x+w/2-tw/2, y+h/2+24, tag)
		}
	}
}

// fillPolygon preenche um polígono por scanline -- suficiente para as formas
// convexas/estreladas simples do escudo, sem uma lib de rasterização.
func fillPolygon(img *image.RGBA, pts []image.Point, c color.RGBA) {
	if len(pts) < 3 {
		return
	}
	minY, maxY := pts[0].Y, pts[0].Y
	for _, p := range pts {
		if p.Y < minY {
			minY = p.Y
		}
		if p.Y > maxY {
			maxY = p.Y
		}
	}
	for y := minY; y <= maxY; y++ {
		var xs []int
		for i := range pts {
			a, b := pts[i], pts[(i+1)%len(pts)]
			if (a.Y <= y && b.Y > y) || (b.Y <= y && a.Y > y) {
				t := float64(y-a.Y) / float64(b.Y-a.Y)
				xs = append(xs, int(float64(a.X)+t*float64(b.X-a.X)))
			}
		}
		for i := 0; i+1 < len(xs); i += 2 {
			x0, x1 := xs[i], xs[i+1]
			if x0 > x1 {
				x0, x1 = x1, x0
			}
			for x := x0; x <= x1; x++ {
				if image.Pt(x, y).In(img.Bounds()) {
					img.SetRGBA(x, y, c)
				}
			}
		}
	}
}

// strokePolygon desenha o contorno ligando os vértices com uma linha grossa.
func strokePolygon(img *image.RGBA, pts []image.Point, c color.RGBA) {
	for i := range pts {
		drawLine(img, pts[i], pts[(i+1)%len(pts)], c, 6)
	}
}

// drawLine traça uma linha grossa (Bresenham com espessura quadrada).
func drawLine(img *image.RGBA, a, b image.Point, c color.RGBA, thick int) {
	dx := int(math.Abs(float64(b.X - a.X)))
	dy := -int(math.Abs(float64(b.Y - a.Y)))
	sx, sy := -1, -1
	if a.X < b.X {
		sx = 1
	}
	if a.Y < b.Y {
		sy = 1
	}
	err := dx + dy
	for {
		for oy := -thick / 2; oy <= thick/2; oy++ {
			for ox := -thick / 2; ox <= thick/2; ox++ {
				p := image.Pt(a.X+ox, a.Y+oy)
				if p.In(img.Bounds()) {
					img.SetRGBA(p.X, p.Y, c)
				}
			}
		}
		if a.X == b.X && a.Y == b.Y {
			break
		}
		e2 := 2 * err
		if e2 >= dy {
			err += dy
			a.X += sx
		}
		if e2 <= dx {
			err += dx
			a.Y += sy
		}
	}
}

// cardFont carrega o "Go Bold" embutido no tamanho pedido. Sem arquivo externo:
// o container é distroless e não tem fontes de sistema.
func cardFont(size float64) (font.Face, error) {
	f, err := opentype.Parse(gobold.TTF)
	if err != nil {
		return nil, fmt.Errorf("parse fonte embutida: %w", err)
	}
	return opentype.NewFace(f, &opentype.FaceOptions{Size: size, DPI: 72, Hinting: font.HintingFull})
}

// drawString desenha texto com a baseline em (x, y).
func drawString(img *image.RGBA, face font.Face, c color.RGBA, x, y int, s string) {
	d := &font.Drawer{
		Dst:  img,
		Src:  &image.Uniform{c},
		Face: face,
		Dot:  fixed.P(x, y),
	}
	d.DrawString(s)
}

// truncate corta nomes longos para não invadir o cartão; "…" sinaliza o corte.
func truncate(s string, max int) string {
	s = strings.TrimSpace(s)
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max-1]) + "…"
}
