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