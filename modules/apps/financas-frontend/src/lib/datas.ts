// Datas do contrato são dias de calendário ("YYYY-MM-DD"); o domínio
// normaliza tudo pra meia-noite UTC. Reparsear esse valor com new
// Date(iso) o trata como instante, e toLocaleDateString converte pro
// fuso local -- em UTC-3, meia-noite UTC vira 21h do dia ANTERIOR e a
// data exibida atrasa um dia. O mesmo vale pro contrário: montar o
// default de um formulário com toISOString() devolve o dia de UTC,
// que à noite já é o dia seguinte pro usuário. Estas duas funções
// tratam o dia de calendário como dia de calendário, sem fuso no
// caminho.
export function formatarDataCalendario(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  if (!ano || !mes || !dia) return iso;
  return new Date(Number(ano), Number(mes) - 1, Number(dia)).toLocaleDateString("pt-BR");
}

export function dataHojeCalendario(): string {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${agora.getFullYear()}-${mes}-${dia}`;
}