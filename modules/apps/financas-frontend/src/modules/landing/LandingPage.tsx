import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { motion } from "framer-motion";
import { ArrowRight, LayoutGrid, Wallet, ArrowLeftRight, LineChart } from "lucide-react";
import { Botao } from "@/components/Botao";
import { CampoTexto } from "@/components/CampoTexto";
import { Selo } from "@/components/Selo";
import { capturarLead } from "@/lib/api/leads";
import { MockContas, MockTransacional, MockInvestimentos, MockDashboard } from "./mockups";

const secoes = [
  {
    icone: Wallet,
    etiqueta: "Contas",
    titulo: (
      <>
        Todas as suas contas,
        <br />
        <em className="font-display-italic">num só lugar.</em>
      </>
    ),
    texto:
      "Corrente ou investimento, banco tradicional ou corretora: cadastre uma vez e toda transação e todo ativo já sabem onde morar.",
    bullets: [
      "Uma conta, um clique para criar",
      "Corrente e investimento, sem confusão",
      "Arquivar em vez de perder histórico",
    ],
    mock: <MockContas />,
  },
  {
    icone: ArrowLeftRight,
    etiqueta: "Transacional",
    titulo: (
      <>
        Lance na mão hoje,
        <br />
        <em className="font-display-italic">deixe a leitura fazer amanhã.</em>
      </>
    ),
    texto:
      "Registre entradas e saídas do dia a dia em segundos, com categoria e conta. Já vem com anexo de comprovante pronto para a leitura automática que chega em breve.",
    bullets: [
      "Lançamento manual em poucos campos",
      "Filtro por conta, período e categoria",
      "Comprovante anexado, OCR a caminho",
    ],
    mock: <MockTransacional />,
  },
  {
    icone: LineChart,
    etiqueta: "Investimentos",
    titulo: (
      <>
        Sua carteira,
        <br />
        <em className="font-display-italic">cotada em tempo real.</em>
      </>
    ),
    texto:
      "Ações e fundos imobiliários com cotação de mercado, custo médio e rentabilidade calculados automaticamente — proventos e vendas incluídos.",
    bullets: [
      "Cotação de mercado atualizada",
      "Custo médio e rentabilidade prontos",
      "Proventos e vendas parciais sem planilha",
    ],
    mock: <MockInvestimentos />,
  },
  {
    icone: LayoutGrid,
    etiqueta: "Dashboard",
    titulo: (
      <>
        Um painel que se molda
        <br />
        <em className="font-display-italic">à sua vida financeira.</em>
      </>
    ),
    texto:
      "Layout padrão pronto para usar, mas totalmente seu: adicione, remova, redimensione e escolha exatamente o que quer ver — sem depender de ninguém para mudar.",
    bullets: [
      "Layout padrão já vem pronto",
      "Blocos livres: mover, redimensionar, remover",
      "Restaurar o padrão a qualquer momento",
    ],
    mock: <MockDashboard />,
  },
];

function FormularioLead() {
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState<"ocioso" | "enviando" | "sucesso" | "erro">("ocioso");

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setEstado("enviando");
    try {
      await capturarLead(email.trim());
      setEstado("sucesso");
    } catch {
      setEstado("erro");
    }
  }

  if (estado === "sucesso") {
    return (
      <p className="font-display text-lg text-positivo">
        Recebido — avisamos assim que abrir o seu acesso.
      </p>
    );
  }

  return (
    <form onSubmit={enviar} className="flex w-full max-w-md flex-col gap-3 sm:flex-row">
      <div className="flex-1">
        <CampoTexto
          type="email"
          required
          placeholder="seu@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-12 rounded-full px-5"
        />
      </div>
      <Botao type="submit" variante="pill" tamanho="lg" disabled={estado === "enviando"}>
        {estado === "enviando" ? "Enviando…" : "Entrar na lista"}
      </Botao>
      {estado === "erro" && (
        <p className="basis-full text-xs text-destructive">
          Não deu certo agora — tenta de novo em instantes.
        </p>
      )}
    </form>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 md:px-10">
        <span className="font-display text-lg font-semibold tracking-tight">◆ finanças</span>
        <nav className="flex items-center gap-2">
          <Link
            to="/entrar"
            className="rounded-full px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Entrar
          </Link>
          <Link
            to="/entrar"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-foreground px-4 text-sm font-medium text-background shadow-lift transition-colors hover:bg-foreground/85"
          >
            Começar
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="textura-papel relative overflow-hidden px-6 pb-20 pt-10 md:px-10 md:pb-32 md:pt-16">
        <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Selo tom="alerta">NOVO · Dashboard modular</Selo>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="mt-6 text-balance font-display text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl md:text-6xl"
          >
            Sua vida financeira,
            <br />
            <em className="font-display-italic text-primary">organizada de verdade.</em>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-6 max-w-xl text-balance text-base text-muted-foreground md:text-lg"
          >
            Contas, transações, investimentos e um dashboard que se molda a você — tudo num só
            lugar, sem planilha e sem clichê de app de banco.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mt-8 flex flex-col items-center gap-4 sm:flex-row"
          >
            <Link
              to="/entrar"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-foreground px-6 text-base font-medium text-background shadow-lift transition-colors hover:bg-foreground/85"
            >
              Começar agora <ArrowRight size={18} />
            </Link>
            <a
              href="#modulos"
              className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Ver como funciona
            </a>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.35 }}
          className="mx-auto mt-16 flex max-w-4xl justify-center"
        >
          <MockDashboard />
        </motion.div>
      </section>

      {/* Módulos, alternando lado a lado -- mesmo ritmo de apresentação da
          orchid.ai (eyebrow + título + texto + 3 bullets + CTA, visual do
          lado oposto), com identidade visual própria. */}
      <section id="modulos" className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-16">
        {secoes.map((s, i) => (
          <div
            key={s.etiqueta}
            className={`flex flex-col items-center gap-10 py-16 md:gap-16 md:py-24 ${
              i % 2 === 1 ? "md:flex-row-reverse" : "md:flex-row"
            }`}
          >
            <div className="flex-1 text-center md:text-left">
              <div className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-primary">
                <s.icone size={16} />
                {s.etiqueta}
              </div>
              <h2 className="text-balance font-display text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
                {s.titulo}
              </h2>
              <p className="mx-auto mt-4 max-w-md text-muted-foreground md:mx-0">{s.texto}</p>
              <ul className="mx-auto mt-6 max-w-md space-y-2 text-left">
                {s.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2.5 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    {b}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-1 justify-center">{s.mock}</div>
          </div>
        ))}
      </section>

      {/* CTA final + captura de lead */}
      <section className="textura-papel border-t border-border px-6 py-20 text-center md:px-10 md:py-28">
        <h2 className="mx-auto max-w-2xl text-balance font-display text-3xl font-semibold leading-tight tracking-tight md:text-5xl">
          Comece a organizar
          <br />
          <em className="font-display-italic">sua vida financeira.</em>
        </h2>
        <p className="mx-auto mt-4 max-w-md text-muted-foreground">
          Deixe seu e-mail e a gente avisa assim que o seu acesso estiver pronto.
        </p>
        <div className="mt-8 flex justify-center">
          <FormularioLead />
        </div>
      </section>

      <footer className="border-t border-border px-6 py-8 text-center text-sm text-muted-foreground md:px-10">
        <span className="font-display">◆ finanças</span> — gestão financeira pessoal.
      </footer>
    </div>
  );
}
