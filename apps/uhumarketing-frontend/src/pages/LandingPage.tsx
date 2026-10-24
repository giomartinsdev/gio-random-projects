import { useEffect } from "react";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Check,
  Filter,
  MessageCircle,
  Send,
  Sparkles,
  Workflow,
  Zap,
} from "lucide-react";
import { useSession } from "@/lib/session";
import { navigate, navigatePublic } from "@/lib/useHashRoute";
import { DotGrid, Eyebrow, LandingButton, OrbGlow } from "@/components/landing/LandingUI";
import { cn } from "@/lib/utils";

export function LandingPage() {
  const { user } = useSession();

  useEffect(() => {
    document.title = "uhumarketing — marketing que se monta";
  }, []);

  return (
    <div className="lp-root min-h-screen overflow-x-hidden">
      <Nav loggedIn={Boolean(user)} />

      {/* ------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden border-b border-lp-line">
        <DotGrid className="text-[#111]" opacity={0.07} />
        <OrbGlow className="-left-40 top-10 h-[520px] w-[520px]" opacity={0.12} />
        <OrbGlow className="-right-32 top-40 h-[460px] w-[460px]" color="#7DA6FF" opacity={0.18} />

        <div className="relative mx-auto flex max-w-[1160px] flex-col items-center gap-6 px-6 pb-16 pt-20 text-center md:pt-24">
          <Eyebrow>
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Marketing no WhatsApp · conta própria
          </Eyebrow>

          <h1 className="max-w-[860px] text-[44px] font-semibold leading-[1.06] tracking-[-0.03em] text-lp-ink md:text-[64px]">
            O marketing do seu negócio,
            <br />
            <span className="text-accent">montado como você pensa.</span>
          </h1>

          <p className="max-w-[600px] text-[16px] leading-relaxed text-lp-ink-2 md:text-[17px]">
            Templates aprovados pela Meta, métricas por mensagem e um canvas livre para desenhar a descoberta dos leads e
            o outbound. Sem planilha no meio, sem campanha caixa-preta.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <LandingButton
              href="#/login"
              variant="accent"
              onClick={(e) => {
                e.preventDefault();
                navigatePublic("login");
              }}
            >
              Entrar <ArrowRight size={16} />
            </LandingButton>
            <LandingButton
              href="#/cadastro"
              variant="outline"
              onClick={(e) => {
                e.preventDefault();
                navigatePublic("cadastro");
              }}
            >
              Criar workspace
            </LandingButton>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pt-2 font-mono text-[10px] uppercase tracking-[0.08em] text-lp-ink-3">
            <span className="flex items-center gap-1.5">
              <Check size={12} /> uma conta por workspace
            </span>
            <span className="flex items-center gap-1.5">
              <Check size={12} /> templates aprovados pela Meta
            </span>
            <span className="flex items-center gap-1.5">
              <Check size={12} /> histórico só seu
            </span>
          </div>

          <ProductFrame />
        </div>
      </section>

      {/* ------------------------------------------------------------ faixa */}
      <section className="border-b border-lp-line bg-lp-surface">
        <div className="mx-auto flex max-w-[1160px] flex-wrap items-center justify-between gap-6 px-6 py-7">
          {[
            ["Templates", "12 aprovados"],
            ["Audiências", "6 segmentos"],
            ["Fluxos", "5 automações"],
            ["Envios rastreados", "1 clique por cupom"],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-lp-ink-3">{label}</span>
              <span className="text-[15px] font-semibold text-lp-ink">{value}</span>
            </div>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------------- recursos */}
      <section id="produto" className="mx-auto flex max-w-[1160px] scroll-mt-20 flex-col gap-10 px-6 py-20">
        <div className="flex flex-col gap-3">
          <Eyebrow>O produto</Eyebrow>
          <h2 className="max-w-[700px] text-[34px] font-semibold leading-[1.12] tracking-[-0.02em] text-lp-ink md:text-[42px]">
            Quatro coisas que o marketing precisa fazer — e uma tela para cada.
          </h2>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Feature
            icon={<MessageCircle size={18} />}
            title="Templates que você entende"
            text="Cada template da Meta com prévia fiel, status de aprovação, qualidade e o desempenho real: entregue, lido, clicado, respondido. O conteúdo não é uma caixa-preta."
            bullets={["Prévia de bolha com variáveis", "Métricas por template", "Rejeição explicada"]}
          />
          <Feature
            icon={<Workflow size={18} />}
            title="Um canvas, não um formulário"
            text="A campanha é um fluxo. Arraste blocos de gatilho, descoberta, oferta e saída; conecte como quiser. O produto valida antes de publicar."
            bullets={["Arraste e conecte blocos", "Simulação antes do envio", "Publicação com gate humano"]}
          />
          <Feature
            icon={<Filter size={18} />}
            title="Regras de descobrimento"
            text="“Leads frios” vira condição executável: última compra, opt-in, tag, UF, total gasto. O universo vem da audiência; as regras decidem quem passa."
            bullets={["Regras E/OU combináveis", "Deduplicação por telefone", "Opt-out respeitado no envio"]}
          />
          <Feature
            icon={<BarChart3 size={18} />}
            title="Outbound com consequência"
            text="Cupom único por pessoa, janela de envio, vazão por minuto e fallback. Cada resposta cai numa fila de atendimento com SLA."
            bullets={["Cupom rastreável por destinatário", "Vazão e janela da Meta", "Handoff para humano"]}
          />
        </div>
      </section>

      {/* ------------------------------------------------------------ canvas */}
      <section id="canvas" className="relative scroll-mt-20 overflow-hidden border-y border-lp-line bg-[#0B0B0D]">
        <DotGrid className="text-white" opacity={0.06} />
        <OrbGlow className="right-0 top-0 h-[500px] w-[500px]" opacity={0.22} />
        <div className="relative mx-auto grid max-w-[1160px] gap-10 px-6 py-20 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div className="flex flex-col gap-5">
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-white/60">
              <Sparkles size={12} /> o jeito n8n
            </span>
            <h2 className="text-[32px] font-semibold leading-[1.12] tracking-[-0.02em] text-white md:text-[40px]">
              Do gatilho ao cupom, no mesmo lugar.
            </h2>
            <p className="max-w-[440px] text-[15px] leading-relaxed text-white/60">
              A pessoa monta o caminho: quem descobre, quem filtra, qual template sai, com qual cupom e por qual número. O
              produto cuida da aprovação, da vazão e do opt-out.
            </p>
            <ul className="flex flex-col gap-2.5">
              {[
                "19 blocos: gatilho, descoberta, mensagem, lógica e saída",
                "Simulação com alcance, custo e mensagem final",
                "Validação que impede publicar template não aprovado",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-[13px] leading-snug text-white/75">
                  <BadgeCheck size={15} className="mt-0.5 shrink-0 text-accent-light" />
                  {t}
                </li>
              ))}
            </ul>
            <LandingButton
              href="#/login"
              variant="accent"
              className="w-fit"
              onClick={(e) => {
                e.preventDefault();
                navigatePublic("login");
              }}
            >
              Abrir o editor <ArrowRight size={16} />
            </LandingButton>
          </div>

          <CanvasMock />
        </div>
      </section>

      {/* --------------------------------------------------------- como roda */}
      <section id="como-funciona" className="mx-auto flex max-w-[1160px] scroll-mt-20 flex-col gap-10 px-6 py-20">
        <div className="flex flex-col gap-3">
          <Eyebrow>Na prática</Eyebrow>
          <h2 className="max-w-[720px] text-[34px] font-semibold leading-[1.12] tracking-[-0.02em] text-lp-ink md:text-[42px]">
            A campanha de reativação, do começo ao fim.
          </h2>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              n: "01",
              title: "Descobrir",
              text: "Audiência “leads frios (90+ dias)” + regras: opt-in sim, última compra > 90 dias. Remove duplicados por telefone.",
            },
            {
              n: "02",
              title: "Ofertar",
              text: "Cupom único por pessoa (VOLTA-ANA), 15% off, 14 dias. O template mapeia nome, cupom, desconto e validade.",
            },
            {
              n: "03",
              title: "Enviar",
              text: "WhatsApp, 120 msg/min, 9h–18h em dias úteis. Quem responde cai no atendimento; sem resposta em 48h, encerra.",
            },
          ].map((s) => (
            <div key={s.n} className="flex flex-col gap-3 rounded-md border border-lp-line bg-lp-surface p-5">
              <span className="font-mono text-[11px] text-accent">{s.n}</span>
              <span className="text-[16px] font-semibold text-lp-ink">{s.title}</span>
              <p className="text-[13px] leading-relaxed text-lp-ink-2">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------------------- CTA */}
      <section className="relative overflow-hidden border-t border-lp-line">
        <DotGrid className="text-[#111]" opacity={0.06} />
        <OrbGlow className="left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2" opacity={0.14} />
        <div className="relative mx-auto flex max-w-[820px] flex-col items-center gap-5 px-6 py-20 text-center">
          <h2 className="text-[34px] font-semibold leading-[1.12] tracking-[-0.02em] text-lp-ink md:text-[44px]">
            Comece com a sua conta, vazia.
          </h2>
          <p className="max-w-[520px] text-[15px] leading-relaxed text-lp-ink-2">
            O cadastro cria um workspace só seu, sem dado de exemplo. Você conecta o número, cria o primeiro template e
            monta a campanha — nada é enviado sem opt-in e template aprovado.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <LandingButton
              href="#/login"
              variant="accent"
              onClick={(e) => {
                e.preventDefault();
                navigatePublic("login");
              }}
            >
              Entrar <ArrowRight size={16} />
            </LandingButton>
            <LandingButton
              href="#/cadastro"
              variant="dark"
              onClick={(e) => {
                e.preventDefault();
                navigatePublic("cadastro");
              }}
            >
              Criar meu workspace
            </LandingButton>
          </div>
        </div>
      </section>

      <footer className="border-t border-lp-line bg-white">
        <div className="mx-auto flex max-w-[1160px] flex-wrap items-center justify-between gap-4 px-6 py-8">
          <div className="flex items-center gap-2.5">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-accent text-[11px]">📣</span>
            <span className="text-[13px] font-semibold text-lp-ink">uhumarketing</span>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-lp-ink-3">
            uhumarketing · marketing no WhatsApp
          </p>
        </div>
      </footer>
    </div>
  );
}

/* ----------------------------------------------------------------- nav */

function Nav({ loggedIn }: { loggedIn: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-lp-line bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1160px] items-center justify-between gap-4 px-6 py-3.5">
        <button onClick={() => navigatePublic("landing")} className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-[13px]">📣</span>
          <span className="text-[15px] font-semibold tracking-tight text-lp-ink">uhumarketing</span>
        </button>

        <nav className="hidden items-center gap-6 md:flex">
          {[
            ["Produto", "produto"],
            ["Canvas", "canvas"],
            ["Como funciona", "como-funciona"],
          ].map(([label, id]) => (
            <a
              key={id}
              href={`#${id}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="text-[13px] text-lp-ink-2 transition-colors hover:text-lp-ink"
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {loggedIn ? (
            <LandingButton
              href="#/app/dashboard"
              variant="dark"
              className="px-4 py-2.5 text-[13px]"
              onClick={(e) => {
                e.preventDefault();
                navigate("dashboard");
              }}
            >
              Abrir o app <ArrowRight size={14} />
            </LandingButton>
          ) : (
            <>
              <button
                onClick={() => navigatePublic("login")}
                className="rounded-sm px-3 py-2 text-[13px] font-medium text-lp-ink-2 transition-colors hover:bg-lp-surface hover:text-lp-ink"
              >
                Entrar
              </button>
              <LandingButton
                href="#/cadastro"
                variant="dark"
                className="px-4 py-2.5 text-[13px]"
                onClick={(e) => {
                  e.preventDefault();
                  navigatePublic("cadastro");
                }}
              >
                Começar
              </LandingButton>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/* --------------------------------------------------------- peças visuais */

function Feature({
  icon,
  title,
  text,
  bullets,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  bullets: string[];
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-lp-line bg-white p-6">
      <span className="grid h-10 w-10 place-items-center rounded-sm bg-accent-soft text-accent">{icon}</span>
      <h3 className="text-[17px] font-semibold text-lp-ink">{title}</h3>
      <p className="text-[13px] leading-relaxed text-lp-ink-2">{text}</p>
      <ul className="mt-1 flex flex-col gap-1.5">
        {bullets.map((b) => (
          <li key={b} className="flex items-center gap-2 text-[12px] text-lp-ink-2">
            <Check size={12} className="shrink-0 text-success" /> {b}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Moldura escura do produto, vista de cima: sidebar + KPIs + gráfico. */
function ProductFrame() {
  return (
    <div className="mt-8 w-full max-w-[980px] overflow-hidden rounded-md border border-[#26262B] bg-[#141416] text-left shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
      <div className="flex items-center gap-2 border-b border-[#26262B] px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#33333A]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#33333A]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#33333A]" />
        <span className="ml-3 rounded-xs bg-[#0B0B0D] px-2.5 py-1 font-mono text-[10px] text-[#6E6E76]">
          app.uhumarketing.com/visao-geral
        </span>
        <span className="ml-auto rounded-xs border border-[#33333A] px-2 py-0.5 font-mono text-[9px] text-[#6E6E76]">
          ilustração
        </span>
      </div>

      <div className="flex h-[330px]">
        <div className="hidden w-[176px] shrink-0 flex-col gap-1 border-r border-[#26262B] p-3 sm:flex">
          <div className="mb-3 flex items-center gap-2 px-1">
            <span className="h-[18px] w-[18px] rounded-full bg-accent" />
            <span className="text-[12px] font-semibold text-white">uhumarketing</span>
          </div>
          {[
            ["Visão geral", true],
            ["Templates Meta", false],
            ["Campanhas", false],
            ["Automação", false],
            ["Audiências", false],
            ["Envios", false],
          ].map(([label, active]) => (
            <div
              key={String(label)}
              className={cn(
                "flex items-center gap-2 rounded-sm px-2 py-1.5 text-[11px]",
                active ? "bg-[#1C1C20] text-white" : "text-[#A8A8B0]",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-accent-light" : "bg-[#33333A]")} />
              {label}
            </div>
          ))}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <div className="flex items-end justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-[15px] font-semibold text-white">Bom dia, Marina</span>
              <span className="text-[10px] text-[#6E6E76]">o que está no ar e o que precisa de decisão</span>
            </div>
            <span className="rounded-full bg-[#12351F] px-2 py-1 font-mono text-[9px] text-success">2 fluxos ativos</span>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {[
              ["Enviadas", "18.402", "+12,4%"],
              ["Leitura", "78,9%", "+3,1%"],
              ["Respostas", "1.183", "−2,2%"],
              ["Receita", "R$ 184k", "+8,6%"],
            ].map(([label, value, trend]) => (
              <div key={label} className="flex flex-col gap-1 rounded-sm border border-[#26262B] bg-[#141416] p-2.5">
                <span className="text-[9px] text-[#A8A8B0]">{label}</span>
                <span className="text-[15px] font-semibold text-white">{value}</span>
                <span className="font-mono text-[8px] text-[#16A34A]">{trend}</span>
              </div>
            ))}
          </div>

          <div className="flex min-h-0 flex-1 gap-2">
            <div className="flex flex-1 flex-col gap-2 rounded-sm border border-[#26262B] p-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-white">Enviadas e lidas</span>
                <span className="font-mono text-[8px] text-[#6E6E76]">30 dias</span>
              </div>
              <SparkMock />
            </div>
            <div className="flex w-[120px] shrink-0 flex-col gap-1.5 rounded-sm border border-[#26262B] p-3">
              <span className="text-[10px] font-medium text-white">Funil</span>
              {[
                ["Enviadas", "100%", "#2563EB"],
                ["Entregues", "97%", "#7DA6FF"],
                ["Lidas", "79%", "#16A34A"],
                ["Convertidas", "8%", "#A78BFA"],
              ].map(([l, v, c]) => (
                <div key={l} className="flex flex-col gap-1">
                  <div className="flex justify-between font-mono text-[8px] text-[#6E6E76]">
                    <span>{l}</span>
                    <span>{v}</span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-[#0B0B0D]">
                    <div className="h-full rounded-full" style={{ width: v, background: c }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SparkMock() {
  const values = [42, 58, 51, 70, 62, 88, 74, 96, 82, 104, 91, 118, 108, 126];
  const max = Math.max(...values);
  const min = Math.min(...values);
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 100 - ((v - min) / (max - min)) * 84 - 8;
      return `${i ? "L" : "M"} ${x} ${y}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="min-h-0 w-full flex-1">
      <defs>
        <linearGradient id="lparea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2563EB" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#2563EB" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${points} L 100 100 L 0 100 Z`} fill="url(#lparea)" />
      <path d={points} fill="none" stroke="#7DA6FF" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      <path
        d={values
          .map((v, i) => {
            const x = (i / (values.length - 1)) * 100;
            const y = 100 - ((v - min) / (max - min)) * 84 - 8;
            return `${i ? "L" : "M"} ${x} ${y + 6}`;
          })
          .join(" ")}
        fill="none"
        stroke="#16A34A"
        strokeWidth="1.4"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Canvas do fluxo, desenhado à mão em HTML — a prova visual do \"n8n\". */
function CanvasMock() {
  const nodes = [
    { x: 8, y: 96, title: "Todo dia útil, 9h", kind: "Agendamento", color: "#7DA6FF", icon: <Zap size={11} /> },
    { x: 8, y: 178, title: "Leads frios (90+ dias)", kind: "Audiência", color: "#16A34A", icon: <Filter size={11} /> },
    { x: 196, y: 60, title: "Regras de descobrimento", kind: "2 regras · todas", color: "#16A34A", icon: <Filter size={11} /> },
    { x: 196, y: 142, title: "Remover duplicados", kind: "por telefone", color: "#16A34A", icon: <Workflow size={11} /> },
    { x: 384, y: 96, title: "Cupom único", kind: "15% · único: sim", color: "#2563EB", icon: <Sparkles size={11} /> },
    { x: 384, y: 178, title: "Template: Volta pro café", kind: "reativacao_cupom_volta", color: "#2563EB", icon: <MessageCircle size={11} /> },
    { x: 560, y: 132, title: "WhatsApp · Aurora", kind: "+55 11 91234-5678", color: "#A78BFA", icon: <Send size={11} /> },
  ];

  return (
    <div className="relative overflow-hidden rounded-md border border-[#26262B] bg-[#0E0E11] p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[10px] text-[#6E6E76]">Reativação com cupom pessoal</span>
        <span className="rounded-full bg-[#12351F] px-2 py-0.5 font-mono text-[9px] text-success">ativo</span>
      </div>

      <div className="relative h-[280px] w-full overflow-hidden rounded-sm">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: "radial-gradient(#24242a 1px, transparent 1px)",
            backgroundSize: "18px 18px",
          }}
        />
        <svg className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none">
          {[
            [110, 112, 196, 76],
            [110, 194, 196, 158],
            [300, 76, 384, 112],
            [300, 158, 384, 194],
            [482, 112, 560, 148],
            [482, 194, 560, 164],
          ].map(([x1, y1, x2, y2], i) => (
            <path
              key={i}
              d={`M ${x1} ${y1} C ${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke="#33333A"
              strokeWidth="1.4"
            />
          ))}
        </svg>

        {nodes.map((n) => (
          <div
            key={n.title}
            className="absolute flex w-[150px] items-center gap-2 rounded-sm border border-[#26262B] bg-[#141416] px-2.5 py-2 shadow-[0_6px_16px_rgba(0,0,0,0.5)]"
            style={{ left: n.x, top: n.y }}
          >
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-xs" style={{ background: `${n.color}22`, color: n.color }}>
              {n.icon}
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[9px] font-semibold text-white">{n.title}</span>
              <span className="truncate text-[8px] text-[#6E6E76]">{n.kind}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
