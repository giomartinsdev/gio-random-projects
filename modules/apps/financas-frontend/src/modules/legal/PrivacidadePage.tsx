import { LegalPage } from "./LegalPage";

export function PrivacidadePage() {
  return (
    <LegalPage titulo="Política de Privacidade">
      <p>
        finanças é um projeto pessoal de gestão financeira. Esta página existe para explicar, de
        forma direta, quais dados coletamos e como eles são usados.
      </p>

      <h2>O que coletamos</h2>
      <p>
        Ao entrar com sua conta Google, recebemos seu e-mail e nome — usados apenas para
        identificar sua conta e isolar seus dados dos de outras pessoas. Não acessamos nada mais
        da sua conta Google além disso.
      </p>
      <p>
        As contas, transações, ativos e dashboards que você cadastra ficam associados só ao seu
        e-mail e não são compartilhados com nenhuma outra pessoa ou serviço.
      </p>

      <h2>Como usamos seus dados</h2>
      <p>
        Seus dados existem exclusivamente para que o produto funcione: mostrar suas contas, suas
        transações e a evolução dos seus investimentos. Não vendemos, alugamos ou compartilhamos
        seus dados com terceiros para publicidade ou qualquer outro fim.
      </p>

      <h2>Onde seus dados ficam</h2>
      <p>
        Os dados são armazenados em um banco de dados próprio, operado por este projeto. Cotações
        de mercado (ações, fundos) são consultadas na brapi.dev apenas para exibir valores
        atualizados dos ativos que você mesmo cadastrou.
      </p>

      <h2>Excluir sua conta e seus dados</h2>
      <p>
        Você pode pedir a exclusão completa dos seus dados a qualquer momento entrando em contato
        pelo e-mail abaixo.
      </p>

      <h2>Contato</h2>
      <p>giovannidealmeidamartins@gmail.com</p>
    </LegalPage>
  );
}
