import { LegalPage } from "./LegalPage";

export function TermosPage() {
  return (
    <LegalPage titulo="Termos de Uso">
      <p>
        finanças é um projeto pessoal, oferecido gratuitamente, para gestão financeira pessoal:
        contas, transações, investimentos e dashboards. Ao criar uma conta, você concorda com os
        termos abaixo.
      </p>

      <h2>O serviço</h2>
      <p>
        O produto é fornecido "como está", sem garantias de disponibilidade contínua. É um
        projeto em evolução constante e pode passar por mudanças, instabilidades ou,
        eventualmente, ser descontinuado.
      </p>

      <h2>Sua conta</h2>
      <p>
        O acesso é feito exclusivamente via login com sua conta Google. Você é responsável pelas
        informações que cadastra e por manter sua conta Google segura.
      </p>

      <h2>Cotações de mercado</h2>
      <p>
        Dados de ativos (ações, fundos) vêm de uma fonte de terceiros (brapi.dev) e podem conter
        atrasos ou imprecisões. O produto não constitui recomendação de investimento.
      </p>

      <h2>Uso aceitável</h2>
      <p>
        Não é permitido usar o serviço para fins ilegais ou tentar comprometer sua segurança ou
        disponibilidade.
      </p>

      <h2>Contato</h2>
      <p>giovannidealmeidamartins@gmail.com</p>
    </LegalPage>
  );
}
