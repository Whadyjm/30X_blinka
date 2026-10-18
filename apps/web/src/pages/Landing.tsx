import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowDown, ArrowDownLeft, ArrowRight, ArrowUpRight, Bot, Check, CheckCheck,
  ChevronDown, CircleCheck, Code2, FileText, Fingerprint, Hand, History,
  Mail, MessageCircle, Paperclip, Pause, Play, Send, ShieldCheck,
  SlidersHorizontal, X,
} from 'lucide-react';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { Logo } from '@/components/Logo';
import { Oli } from '@/components/Oli';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { brand } from '@/config/brand';
import { useMe } from '@/hooks/queries';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { getLang, t } from '@/i18n';
import '@/styles/landing.css';
import '@/styles/landing-motion.css';

// Keep marketing copy local: this redesign must not change application translations.
const l = (es: string, en: string) => getLang() === 'es' ? es : en;
const cases = [
  { id: 'valid', state: 'happy', amount: '$240.00', Icon: CircleCheck },
  { id: 'review', state: 'understanding', amount: '$650.00', Icon: Hand },
  { id: 'duplicate', state: 'focused', amount: '$240.00', Icon: ShieldCheck },
] as const;

function exampleCopy(index: number) {
  return [
    {
      label: l('Dentro de tus reglas', 'Within your rules'), outcome: l('Autorización simulada', 'Simulated authorization'),
      message: l('Todo en orden. El proveedor está permitido, el acuerdo coincide y hay presupuesto.', 'All checks out. The vendor is allowed, the agreement matches, and budget is available.'),
      rule: l('Dentro del límite automático de $300', 'Within the $300 automatic limit'),
      note: l('Original leído y datos críticos corroborados', 'Original read and critical fields corroborated'),
    },
    {
      label: l('Necesita tu aprobación', 'Needs your approval'), outcome: l('Te toca decidir', 'Your decision to make'),
      message: l('Esta factura supera tu límite automático. Está dentro del techo de $1.000, pero necesito tu aprobación.', 'This invoice exceeds your automatic limit. It is below the $1,000 ceiling, but I need your approval.'),
      rule: l('Supera el límite automático de $300', 'Above the $300 automatic limit'),
      note: l('Las demás reglas se cumplen; requiere una persona', 'Other rules pass; a person must review'),
    },
    {
      label: l('Factura duplicada', 'Duplicate invoice'), outcome: l('Autorización bloqueada', 'Authorization blocked'),
      message: l('Esta factura ya fue registrada. La frené para evitar una segunda autorización.', 'This invoice is already on record. I blocked it to prevent a second authorization.'),
      rule: l('Duplicado confirmado en el historial', 'Confirmed duplicate in the history'),
      note: l('Un duplicado no se puede aprobar por excepción', 'A duplicate cannot be approved as an exception'),
    },
  ][index]!;
}

export function Landing() {
  const me = useMe();
  const signedIn = !!me.data;
  const reducedMotion = usePrefersReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  const [waving, setWaving] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);
  const [heroVisible, setHeroVisible] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  const current = cases[selected]!;
  const example = exampleCopy(selected);
  const CurrentIcon = current.Icon;
  const paused = reducedMotion || motionPaused;
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => setTabVisible(!document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    const observer = new IntersectionObserver(([entry]) => setHeroVisible(!!entry?.isIntersecting));
    const hero = root.current?.querySelector('.landing-hero');
    if (hero) observer.observe(hero);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', sync); };
  }, []);

  // Scenes reveal once (data-inview) and run their loops only while on screen (data-active).
  useEffect(() => {
    const scenes = root.current?.querySelectorAll<HTMLElement>('[data-scene]') ?? [];
    const reveal = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.setAttribute('data-inview', ''); reveal.unobserve(entry.target); }
    }), { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
    const active = new IntersectionObserver((entries) => entries.forEach((entry) => {
      entry.target.toggleAttribute('data-active', entry.isIntersecting);
    }));
    scenes.forEach((scene) => { reveal.observe(scene); active.observe(scene); });
    return () => { reveal.disconnect(); active.disconnect(); };
  }, []);

  // Gentle pointer parallax for the hero stage decorations; Oli's own cursor-follow stays in the shared renderer.
  useEffect(() => {
    const el = stage.current;
    if (!el || paused || !heroVisible || !window.matchMedia('(pointer: fine)').matches) return;
    let frame = 0;
    const move = (event: PointerEvent) => {
      const box = el.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width - .5;
      const y = (event.clientY - box.top) / box.height - .5;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { el.style.setProperty('--px', x.toFixed(3)); el.style.setProperty('--py', y.toFixed(3)); });
    };
    const reset = () => { el.style.setProperty('--px', '0'); el.style.setProperty('--py', '0'); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', reset);
    return () => { cancelAnimationFrame(frame); el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', reset); reset(); };
  }, [paused, heroVisible]);

  useEffect(() => {
    if (!waving) return;
    const timer = window.setTimeout(() => setWaving(false), 1600);
    return () => window.clearTimeout(timer);
  }, [waving]);

  const cta = () => (
    <Link to={signedIn ? '/app' : '/login'} className="landing-button landing-button-primary">
      {signedIn ? t('Open app') : brand.cta}<ArrowUpRight size={18} aria-hidden />
    </Link>
  );

  return (
    <div ref={root} className="oli-landing" data-motion={paused ? 'paused' : 'running'} data-motion-ready={reducedMotion ? undefined : ''} data-tab={tabVisible ? 'visible' : 'hidden'}>
      <a className="landing-skip" href="#landing-main">{l('Ir al contenido', 'Skip to content')}</a>
      <header className="landing-header">
        <div className="landing-wrap landing-nav">
          <Link to="/" aria-label={l('Oli, inicio', 'Oli, home')}><Logo /></Link>
          <nav aria-label={l('Navegación principal', 'Main navigation')}>
            <a href="#how-it-works">{l('Cómo funciona', 'How it works')}</a>
            <a href="#your-rules">{l('Tu control', 'Your control')}</a>
            <a href="#for-agents">{l('Para agentes', 'For agents')}</a>
          </nav>
          <div className="landing-nav-actions">
            <ThemeSwitcher compact /><LanguageSwitcher />
            <Link to={signedIn ? '/app' : '/login'} className="landing-sign-in">{signedIn ? t('Open app') : t('Sign in')}<ArrowUpRight size={15} aria-hidden /></Link>
          </div>
        </div>
      </header>
      <main id="landing-main">
        <section className="landing-hero landing-wrap" data-scene="hero" aria-labelledby="landing-title">
          <div className="landing-hero-copy">
            <h1 id="landing-title">{brand.tagline}<span className="landing-title-dot">.</span></h1>
            <p className="landing-hero-description">{l('Tus agentes solicitan. Oli revisa. Tú tienes el control.', 'Your agents request. Oli reviews. You stay in control.')}</p>
            <p className="landing-hero-detail">{l('Tu guardián financiero lee facturas, aplica tus reglas y te consulta cuando hace falta. Cada decisión, con su porqué.', 'Your financial guardian reads invoices, applies your rules, and brings you in when needed. Every decision comes with a why.')}</p>
            <div className="landing-hero-actions">{cta()}<a href="#how-it-works" className="landing-text-link">{l('Así trabaja Oli', 'See Oli at work')}<ArrowDown size={16} aria-hidden /></a></div>
            <p className="landing-demo-note"><span aria-hidden /><span>{l('Demo con datos ficticios. Sin movimientos de dinero.', 'Demo with fictitious data. No money moves.')}</span></p>
          </div>
          <div ref={stage} className="landing-hero-stage" data-case={current.id}>
            <div className="landing-stage-top"><span><span className="landing-live-dot" />{l('Tu guardián financiero', 'Your financial guardian')}</span><button type="button" className="landing-motion-control" aria-label={paused ? l('Activar animaciones', 'Play animations') : l('Pausar animaciones', 'Pause animations')} disabled={reducedMotion} onClick={() => setMotionPaused(!motionPaused)}>{paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}</button></div>
            <div className="landing-orbit" aria-hidden="true"><span><i /></span><span><i /></span><span><i /></span></div>
            <div className="landing-orbit-tag landing-orbit-tag-in"><FileText size={15} aria-hidden />{l('factura.pdf', 'invoice.pdf')}<ArrowDownLeft size={14} aria-hidden /></div>
            <div className="landing-orbit-tag landing-orbit-tag-out"><ShieldCheck size={15} aria-hidden />{l('Tus reglas, siempre', 'Your rules, always')}</div>
            <button type="button" className="landing-oli-button" onClick={() => setWaving(true)} aria-label={l('Saludar a Oli', 'Say hello to Oli')}>
              <Oli size={440} state={waving ? 'celebrating' : current.state} dark={false} particles={1100} followCursor={!paused && heroVisible} paused={paused || !heroVisible || !tabVisible} label={l('Oli, tu guardián financiero animado', 'Oli, your animated financial guardian')} />
            </button>
            <span className="landing-oli-hint">{waving ? l('¡Hola! Qué gusto conocerte.', 'Hi! So nice to meet you.') : <><span className="landing-pointer-hint">{l('Mueve el cursor. Oli te sigue.', 'Move your cursor. Oli follows you.')}</span><span className="landing-touch-hint">{l('Toca a Oli para saludar.', 'Tap Oli to say hello.')}</span></>}<ArrowUpRight size={14} aria-hidden /></span>
            <div className="landing-hero-receipt" key={current.id} data-enter>
              <div className="landing-receipt-main"><span className="landing-receipt-icon"><FileText size={19} aria-hidden /></span><span><strong>{l('Estudio Lumen', 'Lumen Studio')}</strong><small>{l('Servicios de diseño · Ejemplo ficticio', 'Design services · Fictitious example')}</small></span><strong className="landing-receipt-amount">{current.amount}<small>USD</small></strong></div>
              <div className="landing-receipt-result"><CurrentIcon size={16} aria-hidden /><span>{example.outcome}</span><span className="landing-receipt-time">{l('Ahora', 'Just now')}</span></div>
            </div>
          </div>
          <div className="landing-hero-bottom"><span>{l('La autonomía empieza con límites claros.', 'Autonomy starts with clear limits.')}</span><span><ShieldCheck size={16} aria-hidden />{l('Decide. Registra. Explica.', 'Decide. Record. Explain.')}</span></div>
        </section>
        <div className="landing-channel-strip" data-scene="channels"><div className="landing-wrap"><p>{l('Un guardián. Todos tus canales.', 'One guardian. All your channels.')}</p><div><span><MessageCircle aria-hidden />{l('Conversación', 'Conversation')}</span><span><Mail aria-hidden />Email</span><span><Send aria-hidden />Telegram</span><span><Bot aria-hidden />{l('Tus agentes', 'Your agents')}</span><span><Code2 aria-hidden />API & Skill</span></div></div></div>

        <section id="how-it-works" className="landing-section landing-wrap landing-decisions" data-scene="decisions" aria-labelledby="decisions-title">
          <div className="landing-section-heading"><h2 id="decisions-title">{l('Sabe cuándo actuar.', 'Knows when to act.')}<br /><span>{l('Y cuándo preguntarte.', 'And when to ask you.')}</span></h2><p>{l('Una factura no es solo un importe. Oli contrasta el documento, el proveedor, el acuerdo y tu presupuesto antes de decidir.', 'An invoice is more than an amount. Oli checks the document, vendor, agreement, and your budget before making a decision.')}</p></div>
          <div className="landing-decision-demo">
            <div className="landing-case-list" role="group" aria-label={l('Prueba un caso de ejemplo', 'Try an example scenario')}>
              {cases.map((item, index) => <button key={item.id} type="button" onClick={() => setSelected(index)} aria-pressed={selected === index} className="landing-case-button"><span className="landing-case-symbol"><item.Icon size={20} aria-hidden /></span><span><strong>{exampleCopy(index).label}</strong><small>{index === 0 ? l('Proveedor permitido, todo coincide', 'Allowed vendor, everything matches') : index === 1 ? l('Por encima de tu límite automático', 'Above your automatic limit') : l('El mismo cobro, por segunda vez', 'The same invoice, a second time')}</small></span><ArrowUpRight size={18} aria-hidden /></button>)}
              <p className="landing-example-caption"><SlidersHorizontal size={14} aria-hidden />{l('Ejemplo: automático $300 · techo $1.000 · presupuesto disponible.', 'Example: $300 automatic limit · $1,000 ceiling · budget available.')}</p>
            </div>
            <div className="landing-decision-output" aria-live="polite" aria-atomic="true" data-case={current.id}>
              <div className="landing-output-top"><span className="landing-mini-oli" aria-hidden><span /><span /></span><span>{brand.name}<small>{l('Revisión de factura · Demo interactiva', 'Invoice review · Interactive demo')}</small></span><span className="landing-output-amount"><span key={current.id} data-enter>{current.amount}</span><small>USD</small></span></div>
              <p className="landing-output-message" key={`message-${current.id}`} data-enter>{example.message}</p>
              <ul className="landing-checks" key={`checks-${current.id}`} data-enter><li><Check size={15} aria-hidden />{example.note}</li><li><CurrentIcon size={15} aria-hidden />{example.rule}</li><li><History size={15} aria-hidden />{l('Decisión y motivo registrados', 'Decision and reason recorded')}</li></ul>
              <div className="landing-output-verdict" key={`verdict-${current.id}`} data-enter><CurrentIcon size={17} aria-hidden /><strong>{example.outcome}</strong><span>{l('Simulación', 'Simulation')}</span></div>
            </div>
          </div>
        </section>
        <section id="your-rules" className="landing-control" data-scene="control" aria-labelledby="control-title">
          <div className="landing-wrap landing-control-grid">
            <div className="landing-control-copy"><h2 id="control-title">{l('Tu empresa.', 'Your company.')}<br />{l('Tus reglas.', 'Your rules.')}<br /><span>{l('Su criterio.', 'Oli’s judgment.')}</span></h2><p>{l('Define hasta dónde llega su autonomía. Oli se encarga de respetarlo, factura por factura.', 'Define how far autonomy can go. Oli respects those boundaries, invoice by invoice.')}</p><a href="#traceability" className="landing-text-link">{l('El control también se puede explicar', 'Control you can explain')}<ArrowRight size={17} aria-hidden /></a></div>
            <div className="landing-mandate" aria-label={l('Ejemplo ficticio de mandato financiero', 'Fictitious financial mandate example')}>
              <div className="landing-mandate-header"><span><SlidersHorizontal size={17} aria-hidden />{l('Mandato de tu empresa', 'Your company mandate')}</span><span>{l('Ejemplo ficticio', 'Fictitious example')}</span></div>
              <div className="landing-limit"><span>{l('Autonomía por factura', 'Autonomy per invoice')}</span><strong>$300<small>USD</small></strong><div className="landing-limit-track"><span /><i aria-hidden /></div><div className="landing-limit-scale"><span>$0</span><span>{l('Techo absoluto: $1.000', 'Absolute ceiling: $1,000')}</span></div></div>
              <dl className="landing-mandate-rows"><div><dt>{l('Presupuesto del periodo', 'Period budget')}</dt><dd>$5,000 <span>USD</span></dd></div><div><dt>{l('Proveedores permitidos', 'Allowed vendors')}</dt><dd><Check size={15} aria-hidden />{l('Solo tu lista', 'Only your list')}</dd></div><div><dt>{l('Acuerdos y duplicados', 'Agreements & duplicates')}</dt><dd><Check size={15} aria-hidden />{l('Se comprueban', 'Checked')}</dd></div><div><dt>{l('Por encima del automático', 'Above the automatic limit')}</dt><dd><Hand size={15} aria-hidden />{l('Revisión humana', 'Human review')}</dd></div></dl>
              <p className="landing-mandate-note"><ShieldCheck size={19} aria-hidden />{l('Si la lectura es incierta, Oli pide revisión. La incertidumbre nunca da permiso para autoaprobar.', 'If a reading is uncertain, Oli asks for review. Uncertainty never grants permission to auto-approve.')}</p>
            </div>
          </div>
        </section>
        <section className="landing-section landing-wrap landing-conversation" data-scene="conversation" aria-labelledby="conversation-title">
          <div className="landing-chat-preview">
            <div className="landing-chat-header"><span className="landing-mini-oli" aria-hidden><span /><span /></span><span>{l('Habla con Oli', 'Talk to Oli')}<small>{l('Ejemplo de conversación', 'Example conversation')}</small></span><MessageCircle size={19} aria-hidden /></div>
            <div className="landing-chat-user">{l('¿Qué facturas necesitan mi atención?', 'Which invoices need my attention?')}</div>
            <div className="landing-chat-typing" aria-hidden="true"><span className="landing-chat-avatar">O</span><span><i /><i /><i /></span></div>
            <div className="landing-chat-answer"><span className="landing-chat-avatar">O</span><div><p>{l('Hay una factura de $650 que supera tu límite automático de $300.', 'There is a $650 invoice above your $300 automatic limit.')}</p><div className="landing-chat-attachment"><FileText size={21} aria-hidden /><span>{l('Estudio Lumen', 'Lumen Studio')}<small>{l('Pendiente de revisión humana', 'Awaiting human review')}</small></span><span>$650</span></div><p className="landing-chat-muted">{l('Puedes revisarla junto con su documento original y las reglas evaluadas.', 'You can review it alongside its original document and the rules evaluated.')}</p></div></div>
            <div className="landing-chat-composer" aria-hidden="true"><Paperclip size={17} /><span>{l('Pregúntale a Oli…', 'Ask Oli anything…')}</span><span><ArrowUpRight size={17} /></span></div>
          </div>
          <div className="landing-conversation-copy"><h2 id="conversation-title">{l('Finanzas que se', 'Finance that feels')}<br /><span>{l('pueden conversar.', 'like a conversation.')}</span></h2><p>{l('Pregunta por tus facturas, consulta el presupuesto o adjunta un documento. Oli conecta la conversación con lo que pasa en tu empresa.', 'Ask about invoices, check your budget, or attach a document. Oli connects the conversation to what is happening in your company.')}</p><div className="landing-copy-detail"><CheckCheck size={20} aria-hidden /><p>{l('Los cambios propuestos necesitan tu confirmación. Tus reglas siguen al mando.', 'Proposed changes need your confirmation. Your rules stay in charge.')}</p></div><div className="landing-channel-labels"><span><MessageCircle size={15} aria-hidden />{l('Web y móvil', 'Web & mobile')}</span><span><Send size={15} aria-hidden />Telegram</span><span><Mail size={15} aria-hidden />Email</span></div></div>
        </section>
        <section id="traceability" className="landing-trace landing-wrap" data-scene="trace" aria-labelledby="trace-title">
          <div className="landing-section-heading"><h2 id="trace-title">{l('Cada decisión tiene', 'Every decision has')}<br /><span>{l('un porqué. Y un rastro.', 'a why. And a trail.')}</span></h2><p>{l('Del documento original a la intervención humana. La historia completa, para entenderla sin abrir el código.', 'From the original document to human review. The complete story, understandable without opening the code.')}</p></div>
          <ol className="landing-timeline"><li><span className="landing-timeline-icon"><FileText size={22} aria-hidden /></span><h3>{l('El original', 'The original')}</h3><p>{l('La factura se conserva para poder volver a la fuente.', 'The invoice is kept so you can always return to the source.')}</p></li><li><span className="landing-timeline-icon"><Fingerprint size={22} aria-hidden /></span><h3>{l('La comprobación', 'The checks')}</h3><p>{l('Datos corroborados y reglas vigentes en esa decisión.', 'Corroborated data and the rules in force for that decision.')}</p></li><li><span className="landing-timeline-icon"><ShieldCheck size={22} aria-hidden /></span><h3>{l('La decisión', 'The decision')}</h3><p>{l('Autorizada, frenada o escalada. Con un motivo claro.', 'Authorized, blocked, or escalated. With a clear reason.')}</p></li><li><span className="landing-timeline-icon"><History size={22} aria-hidden /></span><h3>{l('La historia', 'The history')}</h3><p>{l('Quién intervino y por qué, sin borrar lo que ocurrió antes.', 'Who intervened and why, without erasing what came before.')}</p></li></ol>
        </section>
        <section id="for-agents" className="landing-agents" data-scene="agents" aria-labelledby="agents-title"><div className="landing-wrap landing-agents-grid"><div><h2 id="agents-title">{l('Tus agentes trabajan.', 'Your agents work.')}<br /><span>{l('Oli cuida los límites.', 'Oli guards the limits.')}</span></h2><p>{l('Conecta tu orquestador con Oli Skill o su API. Tus agentes envían el documento y reciben una decisión explicada, bajo el mismo mandato de tu empresa.', 'Connect your orchestrator with Oli Skill or the API. Your agents submit the document and receive an explained decision, under the same company mandate.')}</p><a href="/skills/oli-skill.tar.gz" download className="landing-button landing-button-primary">{l('Descargar Oli Skill', 'Download Oli Skill')}<ArrowDown size={17} aria-hidden /></a><a className="landing-agent-docs" href="/skills/oli/SKILL.md" target="_blank" rel="noreferrer">{l('Leer la documentación', 'Read the documentation')}<ArrowUpRight size={15} aria-hidden /></a></div><div className="landing-agent-flow"><div className="landing-agent-node"><Bot size={24} aria-hidden /><span>{l('Tu agente', 'Your agent')}<small>{l('Envía la factura original', 'Submits the original invoice')}</small></span><FileText size={19} aria-hidden /></div><div className="landing-flow-connector" aria-hidden><span /><ArrowDown size={16} /></div><div className="landing-agent-node landing-agent-node-oli"><span className="landing-mini-oli" aria-hidden><span /><span /></span><span>{brand.name}<small>{l('Lee, contrasta y aplica el mandato', 'Reads, checks, and applies your mandate')}</small></span><ShieldCheck size={20} aria-hidden /></div><div className="landing-flow-connector" aria-hidden><span /><ArrowDown size={16} /></div><div className="landing-agent-result"><span><CircleCheck size={16} aria-hidden />APPROVE</span><span><Hand size={16} aria-hidden />ESCALATE</span><span><X size={16} aria-hidden />BLOCK</span></div><p>{l('Acceso acotado. Sin cambiar reglas ni aprobar excepciones humanas.', 'Scoped access. Cannot change rules or approve human exceptions.')}</p></div></div></section>
        <section className="landing-section landing-wrap landing-faq" data-scene="faq" aria-labelledby="faq-title"><h2 id="faq-title">{l('Todo claro,', 'Clear from')}<br /><span>{l('desde el principio.', 'the start.')}</span></h2><div>{[
          [l('¿Oli mueve dinero real?', 'Does Oli move real money?'), l('No. Esta demo fue construida para el reto Blinka de 30X. Trabaja con empresas y facturas ficticias, y termina en decidir, registrar y explicar. Todas las autorizaciones y reservas son simuladas.', 'No. This demo was built for the 30X Blinka challenge. It uses fictitious companies and invoices, and ends with deciding, recording, and explaining. All authorizations and reservations are simulated.')],
          [l('¿Qué pasa si no puede leer una factura con certeza?', 'What if an invoice cannot be read confidently?'), l('Oli no la autoaprueba. Conserva el documento y solicita aclaración o revisión según el caso. Una respuesta del modelo, aunque tenga formato válido, no basta para autorizar.', 'Oli does not auto-approve it. It keeps the document and requests clarification or review as appropriate. A model response, even in a valid format, is not enough to authorize.')],
          [l('¿Puede una persona saltarse cualquier regla?', 'Can a person override any rule?'), l('No. La revisión humana resuelve excepciones permitidas, como superar el límite automático dentro del techo. Antes de confirmar se vuelven a comprobar las reglas vigentes y el presupuesto. Los bloqueos no se anulan con un simple sí.', 'No. Human review handles allowed exceptions, such as exceeding the automatic limit within the ceiling. Current rules and budget are checked again before confirmation. A simple yes cannot override a block.')],
          [l('¿Cómo se conecta con mis agentes?', 'How does it connect to my agents?'), l('La empresa crea una conexión desde Integraciones y configura la clave en el entorno del agente. La Oli Skill incluye un cliente y el contrato HTTP. Cada conexión solo accede a las facturas que presentó.', 'The company creates a connection in Integrations and configures the key in the agent runtime. Oli Skill includes a client and the HTTP contract. Each connection can only access invoices it submitted.')],
        ].map(([question, answer]) => <details key={question}><summary>{question}<ChevronDown size={18} aria-hidden /></summary><p>{answer}</p></details>)}</div></section>
        <section className="landing-final" data-scene="final"><div className="landing-wrap"><span className="landing-final-mark" aria-hidden><ShieldCheck size={34} strokeWidth={1.3} /></span><h2>{l('Dale autonomía.', 'Give it autonomy.')}<br />{l('Quédate con el control.', 'Keep the control.')}</h2><p>{brand.pitch}</p>{cta()}<span className="landing-final-note">{l('Conoce a Oli con datos ficticios. Sin dinero real.', 'Meet Oli with fictitious data. No real money.')}</span></div></section>
      </main>
      <footer className="landing-footer landing-wrap"><Link to="/" aria-label={l('Oli, inicio', 'Oli, home')}><Logo /></Link><p>{l('Tu guardián financiero en la era de los agentes.', 'Your financial guardian in the age of agents.')}</p><span>{l('Construido para el reto Blinka · 30X', 'Built for the Blinka challenge · 30X')}</span><a href="#landing-title" aria-label={l('Volver arriba', 'Back to top')}><ArrowUpRight size={20} aria-hidden /></a></footer>
    </div>
  );
}
