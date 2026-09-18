// The app's public version and its history, rendered on the home page
// ("Novidades"). One entry per shipped batch, newest first --
// APP_VERSION is just the head of the list, so bumping the app means
// adding an entry, never touching a second constant.
export type Release = {
  version: string;
  // ISO date (yyyy-mm-dd); the home page formats it for pt-BR.
  date: string;
  items: string[];
};

export const CHANGELOG: Release[] = [
  {
    version: "1.6.0",
    date: "2026-09-18",
    items: [
      "Tela de qualidade simplificada: agora são só Baixa, Média e Alta — sem mais combinações de resolução e fps que podiam sair pela culatra.",
      "FPS virou Modo: Performance (60fps, prioriza fluidez) ou Nitidez (poucos fps, prioriza imagem nítida) — mais direto do que escolher um número.",
      "Corrigido o motivo dos números malucos (resolução minúscula tipo 306x180, bitrate baixo com fps alto): o Chrome ligava sozinho um modo de compressão em camadas pra telas compartilhadas, que fatiava o orçamento de banda escondido. Travado numa única camada — a partir de agora o que você pede é o que sai.",
    ],
  },
  {
    version: "1.5.1",
    date: "2026-09-18",
    items: [
      "Simulcast ligado de verdade: em qualidade Original, cada pessoa assistindo passa a receber a resolução que a própria conexão aguenta, trocando sozinha e sem travar quando a rede oscila.",
      "Corrigido: VP9 e o simulcast brigavam entre si e a camada leve nunca chegava a existir — telas em qualidade Original usam VP8 (simulcast de verdade) e o resto continua em VP9 (mais nítido, menos banda).",
    ],
  },
  {
    version: "1.5.0",
    date: "2026-09-18",
    items: [
      "Vídeo compartilhado codifica em VP9 quando o navegador aguenta — mesma nitidez por menos banda, sem trocar nada no servidor.",
      "Começo do simulcast: uma tela em qualidade Original agora sobe em duas resoluções ao mesmo tempo, abrindo caminho pra cada pessoa assistir na que a própria conexão aguenta (troca automática ainda não ligada — ver Novidades técnicas).",
    ],
  },

  {
    version: "1.4.2",
    date: "2026-09-17",
    items: [
      "Qualidade 'Original' bem mais nítida: o teto de banda agora usa a resolução real da sua tela (não mais um valor fixo de 1080p), então uma tela grande recebe um orçamento à altura em vez de ser espremida.",
      "FPS 'Original' volta a pedir 60fps de verdade quando a tela aguenta — com o teto de banda certo, isso já não derruba a resolução como antes.",
      "Em telas muito grandes que não sustentam resolução máxima E 60fps ao mesmo tempo, a troca agora é inteligente por tipo de conteúdo: slides/documentos protegem nitidez, o resto protege fluidez — em vez de sempre esmagar a resolução.",
    ],
  },
  {
    version: "1.4.1",
    date: "2026-09-17",
    items: [
      "Corrigido: o modo 'Original' da tela estava forçando 60fps e saía pior — o encoder derrubava a resolução real pra caber no teto de banda, deixando a imagem borrada e engasgada pra todo mundo. Voltou a deixar o navegador escolher o fps sozinho.",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-09-15",
    items: [
      "A sala agora funciona de verdade no celular: compartilhar, parar, microfone, qualidade e clip ficaram numa barra fixa no rodapé, no alcance do polegar.",
      "No celular o painel de compartilhamento sobe como folha deslizante de baixo, e o picture-in-picture só aparece onde o navegador suporta.",
      "Clips desligados no iPhone — o Safari não grava WebM, então o botão não promete o que não pode cumprir.",
      "Toques mais confortáveis: botões de sobreposição e do cabeçalho maiores, e nada de atalhos de teclado na tela do celular.",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-09-15",
    items: [
      "Clips abrem direto na home — qualquer pessoa assiste no navegador, sem baixar.",
      "Áudio da tela sem o tratamento de voz (fim do robozinho) e modo original pedindo 60fps na captura.",
      "Clips aceitam um nome escolhido por você, e a Clips da home ganhou busca por nome, sala ou pessoa.",
      "Header da sala só com ícones (tooltip carrega a descrição) e sem o flick do botão Compartilhar.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-09-15",
    items: [
      "Sala ociosa: 15 minutos sem ninguém transmitindo dispara um aviso com contagem regressiva e fecha a sala pra todo mundo.",
      "Clips: grave os últimos 5 minutos da sua transmissão, guarde no servidor e baixe depois — a home agora tem uma seção com todos os seus clips.",
      "Modo teatro e spotlight: palco em tela cheia pra todos e a estrela que põe alguém em foco pra sala inteira.",
      "Gráfico de pulso por tile (bitrate dos últimos minutos) e fundo desfocado com a cor da sala.",
      "Multi-nó: várias instâncias do servidor atrás de um endereço, cada sala morando em uma delas — o roteamento é invisível pra quem usa.",
      "/statusz público com o pulso do serviço e métricas Prometheus opcionais (TELA_METRICS=1).",
      "Changelog na home: é daqui que as novidades passam a sair.",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-09-15",
    items: [
      "Sinos de entrada e saída: quem chega toca um tom subindo, quem sai um mais discreto descendo — com botão pra silenciar no cabeçalho.",
      "Botão Reset da sala: um clique reconstrói as conexões de todo mundo quando algo engasga, sem ninguém parar de compartilhar.",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-09-14",
    items: [
      "Picture-in-picture, atalhos de teclado (F, M, V, S) e favicon vivo quando alguém compartilha.",
      "Captura de áudio por janela no Chrome e painel de compartilhamento lateral.",
      "Estatísticas por tile, desativar o vídeo de alguém (com economia real de banda), trocar o próprio nome dentro da sala.",
      "Fullscreen de verdade, modos de proporção com letterbox e diálogo de compartilhamento com fonte, qualidade e FPS.",
    ],
  },
  {
    version: "0.9.0",
    date: "2026-08-28",
    items: [
      "SFU: o vídeo vai de um navegador pro servidor e o servidor reparte pra sala — uma única subida por compartilhamento.",
      "Salas com senha, sem cadastro, e pedido de entrada (knock) pra quem não tem a senha.",
      "Telemetria OpenTelemetry com dashboard no Grafana.",
    ],
  },
];

export const APP_VERSION = CHANGELOG[0].version;