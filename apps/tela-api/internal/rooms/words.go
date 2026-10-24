package rooms

import "crypto/rand"

// Common Portuguese nouns -- animals, food, everyday objects, nature --
// used for both room codes ("abacate98suco") and anonymous display
// names ("Abacate"). Deliberately never people's names: a stranger's
// tile shouldn't look like it belongs to a specific real person, and a
// room code built from one could read as if it were meant for them.
// All lowercase ASCII, no accents -- these get typed by hand, read out
// loud, and dropped into a URL, and diacritics/case just add ways to
// mistype them.
var words = []string{
	"abacate", "abacaxi", "abelha", "agua", "aguia", "alface", "alho",
	"amendoim", "amora", "andorinha", "anel", "aranha", "areia", "arroz",
	"balde", "banana", "baleia", "banco", "barco", "batata", "beterraba",
	"bicicleta", "bolacha", "bolo", "borboleta", "cachorro", "cadeira",
	"cafe", "caju", "caminhao", "campo", "canela", "caneta", "canguru",
	"caracol", "caramelo", "carvao", "casaco", "castanha", "cebola",
	"cenoura", "cereja", "chapeu", "charuto", "chave", "chuva", "cobra",
	"coelho", "cogumelo", "colher", "concha", "coqueiro", "coruja",
	"cristal", "cupim", "diamante", "dourado", "elefante", "escada",
	"escova", "espelho", "esponja", "estrela", "faca", "farofa",
	"feijao", "flauta", "floresta", "flor", "formiga", "fogao",
	"foguete", "folha", "fonte", "fruta", "funil", "galho", "galinha",
	"garfo", "garrafa", "gaveta", "girafa", "goiaba", "gruta", "guarani",
	"guitarra", "hamburguer", "hipopotamo", "ilha", "ima", "jabuti",
	"jacare", "jaca", "jambo", "janela", "jardim", "jarra", "joaninha",
	"jornal", "lagarta", "lagarto", "lago", "laranja", "lapis", "leao",
	"leite", "limao", "lobo", "lontra", "louva", "lua", "macaco", "maca",
	"macaxeira", "madeira", "mamao", "manga", "mangueira", "mapa",
	"maracuja", "marmita", "martelo", "melancia", "melao", "mesa",
	"milho", "minhoca", "montanha", "morango", "morcego", "mostarda",
	"nave", "neve", "novelo", "nuvem", "onca", "orquidea", "ostra",
	"ovelha", "paisagem", "palito", "panela", "pandeiro", "pantera",
	"papagaio", "papel", "para", "pasta", "pato", "pedra", "peixe",
	"pepino", "pera", "pergaminho", "pimenta", "pinguim", "pinha",
	"pinheiro", "planeta", "pombo", "ponte", "porco", "porta",
	"presunto", "quiabo", "queijo", "quintal", "rabanete", "raposa",
	"regua", "relogio", "riacho", "rio", "rocha", "roda", "sabao",
	"sabonete", "salada", "sanduiche", "sapato", "sapo", "sino", "sofa",
	"sol", "sorvete", "suco", "tambor", "tangerina", "tapete",
	"tartaruga", "teclado", "telefone", "tesoura", "tigre", "tijolo",
	"tomate", "toranja", "tornado", "torre", "touro", "trator",
	"trigo", "tucano", "urso", "uva", "vaca", "vagalume", "vale",
	"vassoura", "vela", "veleiro", "vento", "violao", "vulcao", "xicara",
	"zebra",
}

// randomFromSlice picks a uniformly random element by index, using the
// same rejection-sampling approach randomFrom uses for alphabets: with
// len(words) not dividing 256 evenly, plain `b % len` would skew
// towards the first few words.
func randomFromSlice(items []string) (string, error) {
	buf := make([]byte, 1)
	limit := byte(256 - (256 % len(items)))
	for {
		if _, err := rand.Read(buf); err != nil {
			return "", err
		}
		if buf[0] >= limit {
			continue
		}
		return items[int(buf[0])%len(items)], nil
	}
}

func randomWord() (string, error) {
	return randomFromSlice(words)
}

func capitalize(s string) string {
	if s == "" {
		return s
	}
	return string(s[0]-'a'+'A') + s[1:]
}
