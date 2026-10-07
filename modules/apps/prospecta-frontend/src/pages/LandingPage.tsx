import { useState } from "react";
import {
  ArrowRight,
  Bot,
  Building2,
  Check,
  Mail,
  MessageCircle,
  PenLine,
  Play,
  Plus,
  Radar,
  Send,
  Sparkles,
  Target,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Orb } from "@/components/ui/Orb";
import { cn } from "@/lib/utils";
import { DotGrid, Kicker, LandingButton, OrbGlow } from "@/components/landing/LandingUI";

// Conteúdo de demonstração da LP. O design mostra números e clientes de
// exemplo; mantemos o layout fiel, mas rotulamos como ILUSTRATIVO — nada
// aqui é dado real da operação.
const CONSOLE_ROWS = [
  { company: "Nordeste Log", segment: "Logística B2B", channel: "email", status: "Qualificado" },
  { company: "Café Aurora", segment: "Varejo regional", channel: "whatsapp", status: "Abordado" },
  { company: "TecnoParts", segment: "Indústria", channel: "email", status: "Respondeu" },
  { company: "Studio Lima", segment: "Agência de marketing", channel: "whatsapp", status: "Qualificado" },
] as const;

const EXAMPLE_LOGOS = ["Northwind", "Acme Corp", "Lumen", "Vertex", "Kaya"];

const BENEFITS = [
  {
    icon: Radar,
    title: "Encontra quem você não acharia",
    desc: "Agentes varrem a web por sinais de compra e montam listas qualificadas do seu ICP — não da base inteira.",
  },
  {
    icon: PenLine,
    title: "Personalização em escala",
    desc: "Cada lead recebe uma mensagem escrita a partir do contexto real da empresa, no seu tom de voz.",
  },
  {
    icon: Target,
    title: "Pipeline, não listas",
    desc: "O resultado é reunião marcada no seu calendário, não um CSV pra alguém trabalhar depois.",
  },
];

const STEPS = [
  { icon: Building2, n: "01", title: "Cadastre a empresa", desc: "A IA aprende o que você vende, seu diferencial e pra quem faz sentido." },
  { icon: Target, n: "02", title: "Descreva o cliente ideal", desc: "Escreva o ICP em linguagem natural. Sem filtros, listas ou ferramentas complexas." },
  { icon: Bot, n: "03", title: "Agentes em campo", desc: "A IA varre a web, qualifica prospects e enriquece cada contato automaticamente." },
  { icon: Send, n: "04", title: "Aprove e aborde", desc: "Mensagem personalizada por lead, enviada por e-mail e WhatsApp no seu tom." },
];

const STATS = [
  { value: "3x", label: "mais reuniões qualificadas" },
  { value: "24h", label: "para os primeiros leads" },
  { value: "-40%", label: "no custo por reunião" },
];

const CASE_RESULTS = [
  { value: "+312", label: "leads qualificados encontrados" },
  { value: "87", label: "reuniões agendadas" },
  { value: "2h", label: "de trabalho por semana" },
];

const FAQ = [
  { q: "Preciso de uma base de leads?", a: "Não. Você descreve o cliente ideal e os agentes encontram os prospects na web, do zero." },
  { q: "Quais canais de abordagem?", a: "Começamos por e-mail e WhatsApp. Os agentes escrevem a mensagem e você aprova antes do envio." },
  { q: "Isso está de acordo com a LGPD?", a: "Sim. Trabalhamos com dados públicos e opt-out claro, seguindo boas práticas de privacidade." },
  { q: "Quanto tempo até o primeiro lead?", a: "A primeira campanha roda em minutos e os primeiros leads qualificados chegam em até 24h." },
];

const FOOTER_COLS = [
  { title: "Produto", links: ["Como funciona", "Preços", "Casos", "Demo"] },
  { title: "Empresa", links: ["Sobre", "Blog", "Contato", "Carreiras"] },
  { title: "Legal", links: ["Privacidade", "Termos", "LGPD", "Opt-out"] },
];

function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <Radar size={22} className="text-accent" />
      <span className={cn("text-[20px] font-bold tracking-[-0.5px]", dark ? "text-white" : "text-lp-ink")}>Prospecta</span>
    </span>
  );
}

function Section({ id, className, children }: { id?: string; className?: string; children: React.ReactNode }) {
  return (
    <section id={id} className={cn("relative w-full px-6 py-16 sm:px-10 lg:px-[120px]", className)}>
      <div className="mx-auto w-full max-w-[1200px]">{children}</div>
    </section>
  );
}

export function LandingPage() {
  const { user } = useAuth();

  return (
    <div className="lp-root min-h-dvh w-full overflow-x-hidden bg-lp-bg font-sans">
      <LandingNav loggedIn={user !== null} />
      <Hero loggedIn={user !== null} />
      <Logos />
      <Benefits />
      <HowItWorks />
      <Stats />
      <Case />
      <FinalCTA loggedIn={user !== null} />
      <Faq />
      <Footer />
    </div>
  );
}

function LandingNav({ loggedIn }: { loggedIn: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-lp-line/70 bg-lp-bg/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1440px] items-center justify-between px-6 py-4 sm:px-10 lg:px-[120px]">
        <Brand />
        <nav className="hidden items-center gap-8 md:flex">
          <a href="#como-funciona" className="text-[14px] font-medium text-lp-ink-2 transition-colors hover:text-lp-ink">Como funciona</a>
          <a href="#casos" className="text-[14px] font-medium text-lp-ink-2 transition-colors hover:text-lp-ink">Casos</a>
          <a href="#precos" className="text-[14px] font-medium text-lp-ink-2 transition-colors hover:text-lp-ink">Preços</a>
        </nav>
        <div className="flex items-center gap-3">
          {loggedIn ? (
            <LandingButton variant="dark" size="sm" href="#/app">Ir para o app</LandingButton>
          ) : (
            <>
              <a href="#/login" className="hidden text-[14px] font-semibold text-lp-ink transition-colors hover:text-accent sm:inline">
                Entrar
              </a>
              <LandingButton variant="dark" size="sm" href="#/signup">Criar conta</LandingButton>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function Hero({ loggedIn }: { loggedIn: boolean }) {
  return (
    <section className="relative overflow-hidden">
      <DotGrid className="text-[#E3E8F5]" />
      <OrbGlow className="-left-[120px] -top-[160px] h-[420px] w-[420px]" color="#2563EB" opacity={0.18} />
      <OrbGlow className="right-[-60px] top-[-40px] h-[360px] w-[360px]" color="#7DA6FF" opacity={0.22} />
      <OrbGlow className="bottom-[-120px] left-1/2 h-[420px] w-[420px] -translate-x-1/2" color="#2563EB" opacity={0.14} />

      <div className="relative mx-auto flex w-full max-w-[1440px] flex-col items-center gap-[22px] px-6 pb-16 pt-[72px] text-center sm:px-10 lg:px-[120px] lg:pt-[92px]">
        <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-[14px] py-[6px]">
          <Orb state="prospecting" size={20} glow={false} />
          <span className="text-[13px] font-semibold text-accent">Prospecção agêntica com IA</span>
        </span>

        <h1 className="max-w-[820px] text-[40px] font-bold leading-[1.05] tracking-[-2px] text-lp-ink sm:text-[52px] lg:text-[66px]">
          Seu time de prospecção que nunca dorme
        </h1>
        <p className="max-w-[640px] text-[17px] leading-normal text-lp-ink-2 lg:text-[19px]">
          Cadastre sua empresa, descreva o cliente ideal e deixe agentes de IA encontrarem e abordarem prospects na web por
          e-mail e WhatsApp, no piloto automático.
        </p>

        <div className="flex flex-col items-center gap-3 pt-1.5 sm:flex-row">
          <LandingButton variant="accent" href={loggedIn ? "#/app" : "#/signup"}>
            {loggedIn ? "Ir para o app" : "Criar campanha grátis"}
            <ArrowRight size={16} />
          </LandingButton>
          <LandingButton variant="outline" href="#como-funciona">
            <Play size={16} />
            Ver demo de 2 min
          </LandingButton>
        </div>
        <p className="text-[13px] text-lp-ink-3">Sem cartão de crédito · Primeiros leads em até 24h</p>

        <AgentConsole />
      </div>
    </section>
  );
}

// Console ilustrativo do herói: o layout é o do design; o conteúdo é rótulo
// de exemplo, não um dado vindo da API.
function AgentConsole() {
  return (
    <div className="mt-10 w-full max-w-[980px] overflow-hidden rounded-[16px] border border-lp-line bg-white text-left shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      <div className="flex items-center justify-between px-[22px] py-4">
        <span className="flex items-center gap-2.5">
          <Orb state="prospecting" size={22} glow={false} />
          <span className="text-[14px] font-semibold text-lp-ink">Agentes em execução</span>
          <span className="rounded-full bg-lp-surface px-2 py-0.5 text-[11px] font-medium text-lp-ink-3">exemplo</span>
        </span>
        <span className="hidden text-[13px] text-lp-ink-3 sm:inline">12 prospects encontrados hoje</span>
      </div>
      {CONSOLE_ROWS.map((row, i) => (
        <div key={row.company} className={cn("flex items-center justify-between gap-3 px-[22px] py-[14px]", i > 0 && "border-t border-lp-line")}>
          <span className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-accent-soft text-accent">
              <Building2 size={18} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[14px] font-semibold text-lp-ink">{row.company}</span>
              <span className="truncate text-[12px] text-lp-ink-3">{row.segment}</span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full bg-lp-surface px-2.5 py-[5px] text-[12px] font-medium text-lp-ink-2 sm:inline-flex">
              {row.channel === "whatsapp" ? <MessageCircle size={13} /> : <Mail size={13} />}
              {row.channel === "whatsapp" ? "WhatsApp" : "E-mail"}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-[5px] text-[12px] font-semibold text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {row.status}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

function Logos() {
  return (
    <Section className="border-t border-lp-line py-12">
      <div className="flex flex-col items-center gap-6">
        <span className="text-center text-[13px] font-medium uppercase tracking-[0.14em] text-lp-ink-3">
          Times que já prospectam com a Prospecta <span className="normal-case tracking-normal">· exemplo ilustrativo</span>
        </span>
        <div className="flex flex-wrap items-center justify-center gap-x-14 gap-y-4">
          {EXAMPLE_LOGOS.map((logo) => (
            <span key={logo} className="text-[22px] font-bold tracking-[-0.5px] text-lp-ink-3/70">{logo}</span>
          ))}
        </div>
      </div>
    </Section>
  );
}

function Benefits() {
  return (
    <Section id="precos" className="py-[72px]">
      <div className="flex flex-col gap-14">
        <div className="flex max-w-[640px] flex-col gap-3.5">
          <Kicker>Por que a Prospecta</Kicker>
          <h2 className="text-[32px] font-bold leading-[1.15] tracking-[-1px] text-lp-ink lg:text-[40px]">Pipeline, não planilhas de leads</h2>
          <p className="max-w-[560px] text-[16px] leading-normal text-lp-ink-2">
            Agentes fazem o trabalho que hoje consome o dia de um SDR: encontram, enriquecem e abordam — você só aprova.
          </p>
        </div>
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
          {BENEFITS.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex flex-col gap-4">
              <span className="grid h-11 w-11 place-items-center rounded-[12px] bg-accent-soft text-accent">
                <Icon size={20} />
              </span>
              <h3 className="text-[19px] font-semibold tracking-[-0.3px] text-lp-ink">{title}</h3>
              <p className="text-[15px] leading-[1.55] text-lp-ink-2">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

function HowItWorks() {
  return (
    <section id="como-funciona" className="relative overflow-hidden bg-lp-dark px-6 py-[88px] sm:px-10 lg:px-[120px]">
      <DotGrid className="text-[#232327]" />
      <OrbGlow className="left-[-140px] top-[300px] h-[380px] w-[380px]" color="#7DA6FF" opacity={0.3} />
      <OrbGlow className="right-[-120px] top-[-120px] h-[460px] w-[460px]" color="#2563EB" opacity={0.35} />
      <div className="relative mx-auto flex w-full max-w-[1200px] flex-col gap-[52px]">
        <div className="flex max-w-[620px] flex-col gap-3.5">
          <Kicker className="text-accent-light">Como funciona</Kicker>
          <h2 className="text-[32px] font-bold leading-[1.15] tracking-[-1px] text-white lg:text-[40px]">Da sua empresa ao pipeline, com agentes de IA</h2>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ icon: Icon, n, title, desc }) => (
            <div key={n} className="flex flex-col gap-[18px] rounded-[16px] border border-lp-dark-line bg-lp-dark-2 p-6">
              <span className="grid h-11 w-11 place-items-center rounded-[12px] bg-[#26262B] text-accent-light">
                <Icon size={20} />
              </span>
              <span className="text-[14px] font-bold tracking-[0.08em] text-accent-light">{n}</span>
              <h3 className="text-[18px] font-semibold tracking-[-0.3px] text-white">{title}</h3>
              <p className="text-[15px] leading-[1.55] text-[#A8A8A3]">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stats() {
  return (
    <section className="w-full bg-lp-surface px-6 py-16 sm:px-10 lg:px-[120px]">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col items-center gap-10 sm:flex-row sm:justify-between">
        {STATS.map((s) => (
          <div key={s.label} className="flex flex-col items-center gap-1.5 text-center">
            <span className="text-[44px] font-bold leading-none tracking-[-1.5px] text-accent">{s.value}</span>
            <span className="text-[14px] text-lp-ink-2">{s.label}</span>
          </div>
        ))}
      </div>
      <p className="mx-auto mt-6 max-w-[1200px] text-center text-[12px] text-lp-ink-3">Números ilustrativos de exemplo.</p>
    </section>
  );
}

function Case() {
  return (
    <Section id="casos" className="py-[88px]">
      <div className="flex flex-col items-start gap-16 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <Kicker>Caso real · exemplo</Kicker>
          <p className="text-[22px] font-medium leading-[1.35] tracking-[-0.4px] text-lp-ink lg:text-[26px]">
            "Parei de comprar listas de leads. Descrevo meu cliente ideal e os agentes voltam com reuniões na agenda. É
            outro jogo."
          </p>
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-accent text-[14px] font-semibold text-white">MR</span>
            <span className="flex flex-col gap-0.5">
              <span className="text-[15px] font-semibold text-lp-ink">Marina Reis</span>
              <span className="text-[13px] text-lp-ink-2">Head de Growth · Lumen</span>
            </span>
          </div>
        </div>
        <div className="flex w-full shrink-0 flex-col gap-[18px] rounded-[18px] bg-lp-dark p-8 lg:w-[400px]">
          <span className="text-[13px] font-semibold uppercase tracking-[0.14em] text-accent-light">Em 90 dias</span>
          {CASE_RESULTS.map((r) => (
            <div key={r.label} className="flex items-end gap-3.5">
              <span className="text-[26px] font-bold tracking-[-0.5px] text-white">{r.value}</span>
              <span className="pb-1 text-[14px] text-[#A8A8A3]">{r.label}</span>
            </div>
          ))}
          <span className="text-[11px] text-lp-ink-3">Valores ilustrativos de exemplo.</span>
        </div>
      </div>
    </Section>
  );
}

function FinalCTA({ loggedIn }: { loggedIn: boolean }) {
  return (
    <section className="relative overflow-hidden bg-accent px-6 py-[72px] sm:px-10 lg:px-[120px] lg:py-[104px]">
      <DotGrid className="text-[#4E86F5]" />
      <OrbGlow className="right-[-120px] top-[120px] h-[380px] w-[380px]" color="#FFFFFF" opacity={0.3} />
      <OrbGlow className="left-[-120px] top-[-100px] h-[420px] w-[420px]" color="#FFFFFF" opacity={0.35} />
      <div className="relative mx-auto flex w-full max-w-[1200px] flex-col items-center gap-[22px] text-center">
        <h2 className="max-w-[760px] text-[34px] font-bold leading-[1.1] tracking-[-1.5px] text-white lg:text-[50px]">
          Comece a prospectar com agentes hoje
        </h2>
        <p className="max-w-[560px] text-[18px] leading-normal text-[#D6F0E4]">
          Crie sua primeira campanha em minutos e receba leads qualificados nos próximos dias.
        </p>
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <LandingButton variant="dark" size="lg" href={loggedIn ? "#/app" : "#/signup"}>
            {loggedIn ? "Ir para o app" : "Criar campanha grátis"}
            <ArrowRight size={16} />
          </LandingButton>
          <LandingButton variant="outlineOnAccent" size="lg" href={loggedIn ? "#/app" : "#/login"}>
            {loggedIn ? "Abrir cockpit" : "Falar com vendas"}
          </LandingButton>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <Section className="py-[88px]">
      <div className="flex flex-col gap-12 lg:flex-row lg:gap-20">
        <div className="flex max-w-[420px] flex-col gap-3.5">
          <Kicker>Perguntas frequentes</Kicker>
          <h2 className="text-[28px] font-bold leading-[1.15] tracking-[-1px] text-lp-ink lg:text-[36px]">
            Tudo que você quer saber antes de começar
          </h2>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {FAQ.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q} className={cn("flex flex-col gap-2.5 py-[26px]", i > 0 && "border-t border-lp-line")}>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-6 text-left"
                >
                  <span className="text-[17px] font-semibold tracking-[-0.2px] text-lp-ink lg:text-[18px]">{item.q}</span>
                  <Plus size={20} className={cn("shrink-0 text-lp-ink-2 transition-transform", isOpen && "rotate-45")} />
                </button>
                {isOpen && <p className="max-w-[620px] text-[15px] leading-[1.6] text-lp-ink-2">{item.a}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

function Footer() {
  return (
    <footer className="w-full border-t border-lp-line bg-lp-surface px-6 pb-10 pt-16 sm:px-10 lg:px-[120px]">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-11">
        <div className="flex flex-col gap-10 lg:flex-row lg:justify-between">
          <div className="flex max-w-[320px] flex-col gap-3.5">
            <Brand />
            <p className="text-[14px] leading-[1.55] text-lp-ink-2">
              Prospecção agêntica por e-mail e WhatsApp para PMEs que querem pipeline sem contratar SDR.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-16 gap-y-8">
            {FOOTER_COLS.map((col) => (
              <div key={col.title} className="flex flex-col gap-3">
                <span className="text-[13px] font-semibold tracking-[0.08em] text-lp-ink">{col.title}</span>
                {col.links.map((link) => (
                  <span key={link} className="text-[14px] text-lp-ink-2">{link}</span>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-4 border-t border-lp-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-[13px] text-lp-ink-3">© 2026 Prospecta. Todos os direitos reservados.</span>
          <span className="flex items-center gap-4 text-lp-ink-3">
            <Sparkles size={16} />
            <Check size={16} />
          </span>
        </div>
      </div>
    </footer>
  );
}
