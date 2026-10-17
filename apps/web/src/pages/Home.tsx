import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import {
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  Clock,
  Ban,
  ExternalLink,
  FileText,
  Paperclip,
  Plus,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { Oli, type OliState } from '@/components/Oli';
import { useMe } from '@/hooks/queries';
import '@/styles/proposal.css';

// Illustrative records for proposal mode. No API or payment authority.
const PROPOSAL_INVOICES = [
  {
    id: 'acme',
    vendor: 'Acme Accounting Demo',
    concept: 'Contabilidad · OCT-026',
    amount: 450,
    status: 'review' as const,
    reason:
      'El importe de USD 450 supera el límite automático de USD 300. Requiere revisión de una persona autorizada; no se ha reservado presupuesto.',
  },
  {
    id: 'cloud',
    vendor: 'Cloud Hosting Demo',
    concept: 'Infraestructura · OCT-014',
    amount: 200,
    status: 'approved' as const,
    reason:
      'Coincide con el acuerdo del proveedor, está dentro del límite automático y tiene presupuesto disponible. Autorización simulada; no se ejecutó un pago.',
  },
  {
    id: 'fibra',
    vendor: 'Fibra Norte Demo',
    concept: 'Internet · OCT-008',
    amount: 89,
    status: 'approved' as const,
    reason:
      'Servicio mensual de internet por USD 89, coincidente con su acuerdo. Autorización simulada; no se ejecutó un pago.',
  },
  {
    id: 'pixel',
    vendor: 'Pixel Mesa Demo',
    concept: 'Diseño · OCT-011',
    amount: 120,
    status: 'blocked' as const,
    reason:
      'El número de factura ya aparece en el historial del proveedor. Este cobro duplicado no crea otra reserva de presupuesto.',
  },
  {
    id: 'linea',
    vendor: 'Línea Studio Demo',
    concept: 'Herramientas · OCT-003',
    amount: 160,
    status: 'approved' as const,
    reason:
      'Coincide con el acuerdo vigente y respeta el mandato. Autorización simulada; no se ejecutó un pago.',
  },
];

const INTERNET_SEPTEMBER = {
  vendor: 'Fibra Norte Demo',
  amount: 89,
  invoice: 'SEP-008',
  period: 'septiembre de 2026',
};

const PROPOSAL_BUDGET = {
  total: 2000,
  reserved: PROPOSAL_INVOICES.filter((i) => i.status === 'approved').reduce((sum, i) => sum + i.amount, 0),
};

const HINTS = [
  'Quiero agregar un proveedor…',
  '¿Cuánto gasté en internet el mes pasado?',
  '¿Qué facturas necesitan mi revisión?',
  'Explícame cómo va mi presupuesto…',
];

function intentFor(text: string) {
  const s = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/\b(paga|pagale|transferir|transfiere)\b/.test(s)) return 'help';
  if (/proveedor/.test(s)) return /agregar|anadir|nuevo|crear|registrar|alta/.test(s) ? 'add-vendor' : 'vendors';
  if (/factura.*fibra/.test(s)) return 'fibra';
  if (/internet|fibra/.test(s)) return 'internet';
  if (/presupuesto|mi mes|este mes|resumen|cuanto gaste/.test(s)) return 'budget';
  if (/duplicad|pixel|bloquead|rechazad/.test(s)) return 'blocked';
  if (/cloud|hosting/.test(s)) return 'cloud';
  if (/linea studio/.test(s)) return 'linea';
  if (/atencion|pendiente|revis|acme|aproba/.test(s)) return 'review';
  if (/factura|subir|adjunt/.test(s)) return 'upload';
  return 'help';
}

function validateAttachments(newFiles: File[], existingCount: number): string | null {
  if (existingCount + newFiles.length > 4) {
    return 'Adjunta hasta 4 facturas a la vez. Puedes quitar un archivo y volver a intentarlo.';
  }
  for (const f of newFiles) {
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(f.type)) {
      return 'Ese formato no está admitido. Prueba con un PDF, PNG o JPG.';
    }
    if (f.size === 0 || f.size > 5 * 1024 * 1024) {
      return 'Cada archivo debe tener contenido y pesar como máximo 5 MB.';
    }
  }
  return null;
}

const money = (n: number) =>
  'USD ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface ChatTurn {
  id: string;
  kind: 'user' | 'assistant';
  text?: string;
  files?: { name: string; size: number }[];
  isPending?: boolean;
  contentNode?: ReactNode;
}

interface LocalVendor {
  name: string;
  service: string;
}

export function Home() {
  const me = useMe();
  const location = useLocation();

  const [promptText, setPromptText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [chatActive, setChatActive] = useState(false);
  const [oliState, setOliState] = useState<OliState>('idle');
  const [busy, setBusy] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [hintIndex, setHintIndex] = useState(0);
  const [invoiceFilter, setInvoiceFilter] = useState<'all' | 'approved' | 'review' | 'blocked'>('all');
  const [isDragging, setIsDragging] = useState(false);
  const [vendors, setVendors] = useState<LocalVendor[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const dragCounter = useRef(0);

  const showToast = (text: string) => {
    setToastMessage(text);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  // Scroll to #facturas or #inicio if hash present or triggered
  useEffect(() => {
    const hash = location.hash || window.location.hash;
    if (hash === '#facturas') {
      const el = document.getElementById('facturas');
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 100);
      }
    } else if (hash === '#inicio') {
      const el = document.getElementById('inicio');
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 100);
      }
    }
  }, [location.hash]);

  // Hint rotation
  useEffect(() => {
    const timer = setInterval(() => {
      if (
        document.hidden ||
        promptText ||
        document.activeElement === textareaRef.current ||
        chatActive ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        return;
      }
      setHintIndex((prev) => (prev + 1) % HINTS.length);
    }, 4500);
    return () => clearInterval(timer);
  }, [promptText, chatActive]);

  // Auto-scroll chat messages
  useEffect(() => {
    if (chatActive && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, chatActive]);

  const handleFilesSelected = (filesList: FileList | null) => {
    if (!filesList || filesList.length === 0) return;
    const additions = Array.from(filesList);
    const err = validateAttachments(additions, attachedFiles.length);
    setInputError(err);
    if (err) return;

    setAttachedFiles((prev) => [...prev, ...additions]);
    setOliState('understanding');
    showToast(
      additions.length === 1
        ? 'Factura adjunta. Envíala cuando quieras.'
        : `${additions.length} facturas adjuntas. Puedes enviarlas juntas.`
    );
  };

  const removeFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
    setInputError(null);
  };

  const ask = async (text: string, filesToSend: File[] = []) => {
    if (busy) return;
    const query = text.trim();
    const currentFiles = filesToSend.length > 0 ? filesToSend : [...attachedFiles];
    if (!query && currentFiles.length === 0) return;

    setBusy(true);
    setChatActive(true);
    setPromptText('');
    setAttachedFiles([]);
    setInputError(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = '';
    }

    // Add user message
    const userTurnId = 'user-' + Date.now();
    const userMsg = query || (currentFiles.length === 1 ? 'Revisemos esta factura.' : 'Revisemos estas facturas.');
    const userFiles = currentFiles.map((f) => ({ name: f.name, size: f.size }));

    setMessages((prev) => [
      ...prev,
      { id: userTurnId, kind: 'user', text: userMsg, files: userFiles },
    ]);

    setOliState('thinking');

    // Add pending assistant bubble
    const pendingTurnId = 'pending-' + Date.now();
    setMessages((prev) => [
      ...prev,
      { id: pendingTurnId, kind: 'assistant', text: 'Un momento…', isPending: true },
    ]);

    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 80 : 650;
    await new Promise((r) => setTimeout(r, delay));

    // Remove pending turn and render reply
    const replyTurnId = 'assistant-' + Date.now();
    const content = renderAssistantReply(query, currentFiles);

    setMessages((prev) =>
      prev.filter((m) => m.id !== pendingTurnId).concat({
        id: replyTurnId,
        kind: 'assistant',
        contentNode: content,
      })
    );

    setBusy(false);
    setOliState('understanding');
  };

  const renderAssistantReply = (text: string, files: File[]) => {
    if (files.length > 0) {
      return (
        <div>
          <p>
            {files.length === 1
              ? 'Tienes un archivo listo para revisar.'
              : `Tienes ${files.length} archivos listos para revisar.`}
          </p>
          {files.map((file, idx) => (
            <div key={idx} className="review-line">
              <span>{file.name}</span>
              <small>{Math.ceil(file.size / 1024)} KB</small>
            </div>
          ))}
          <p className="answer-note">
            En esta propuesta no se leen ni se suben los archivos. En el flujo conectado, Oli extraería los datos,
            comprobaría las reglas y registraría una decisión.
          </p>
          <div className="reply-actions">
            <Link to="/app/bills" className="outline-button">
              Probar una carga real en la app actual <ExternalLink className="icon ml-1.5 size-3.5" />
            </Link>
          </div>
        </div>
      );
    }

    const intent = intentFor(text);

    switch (intent) {
      case 'add-vendor':
        return <VendorInlineForm onConfirmed={(vendor) => {
          setVendors((prev) => [...prev, vendor]);
          setOliState('happy');
          showToast('Borrador de ejemplo confirmado.');
        }} onCancelled={() => setOliState('idle')} />;

      case 'vendors':
        return (
          <div>
            <p>
              {vendors.length
                ? 'Estos son los borradores que añadiste en esta propuesta:'
                : 'Todavía no añadiste proveedores en esta propuesta. Podemos preparar el primero.'}
            </p>
            {vendors.map((v, i) => (
              <p key={i}>
                {v.name} · {v.service}
              </p>
            ))}
            <div className="reply-actions">
              <button
                type="button"
                className="outline-button"
                onClick={() => void ask('Quiero agregar un proveedor')}
              >
                Agregar proveedor
              </button>
            </div>
          </div>
        );

      case 'internet':
        return (
          <InternetAnswer
            september={INTERNET_SEPTEMBER}
          />
        );

      case 'budget':
        return (
          <div>
            <p>Tu ejemplo de octubre tiene margen para seguir operando.</p>
            <strong className="answer-number">{money(PROPOSAL_BUDGET.total - PROPOSAL_BUDGET.reserved)} disponibles</strong>
            <p>
              Hay {money(PROPOSAL_BUDGET.reserved)} reservados de un presupuesto de {money(PROPOSAL_BUDGET.total)}. La
              factura pendiente de USD 450 todavía no consume presupuesto. La duplicada de USD 120 está bloqueada.
            </p>
            <p className="answer-note">
              Datos de ejemplo. Las reservas representan autorizaciones simuladas, no pagos ejecutados.
            </p>
          </div>
        );

      case 'blocked': {
        const inv = PROPOSAL_INVOICES.find((i) => i.id === 'pixel');
        return inv ? <InvoiceAnswerCard invoice={inv} /> : null;
      }
      case 'cloud': {
        const inv = PROPOSAL_INVOICES.find((i) => i.id === 'cloud');
        return inv ? <InvoiceAnswerCard invoice={inv} /> : null;
      }
      case 'linea': {
        const inv = PROPOSAL_INVOICES.find((i) => i.id === 'linea');
        return inv ? <InvoiceAnswerCard invoice={inv} /> : null;
      }
      case 'fibra': {
        const inv = PROPOSAL_INVOICES.find((i) => i.id === 'fibra');
        return inv ? <InvoiceAnswerCard invoice={inv} /> : null;
      }
      case 'review': {
        const inv = PROPOSAL_INVOICES.find((i) => i.id === 'acme');
        return inv ? <InvoiceAnswerCard invoice={inv} /> : null;
      }

      case 'upload':
        return (
          <div>
            <p>
              Puedes adjuntar un PDF, PNG o JPG desde el clip, o arrastrarlo al campo de mensaje. Hasta 4 archivos de 5
              MB por vez.
            </p>
            <p className="answer-note">
              La propuesta muestra cómo sería la interacción. Para procesar documentos usa la app actual.
            </p>
          </div>
        );

      default:
        return (
          <div>
            <p>
              Esta propuesta tiene tres recorridos para explorar: preparar un proveedor, consultar internet o revisar una
              factura pendiente. ¿Por cuál empezamos?
            </p>
            <div className="reply-actions">
              <button type="button" onClick={() => void ask('Quiero agregar un proveedor')}>
                Proveedor
              </button>
              <button type="button" onClick={() => void ask('Gastos de internet')}>
                Internet
              </button>
              <button type="button" onClick={() => void ask('Facturas pendientes')}>
                Pendientes
              </button>
            </div>
          </div>
        );
    }
  };

  const handleResetChat = () => {
    setMessages([]);
    setChatActive(false);
    setPromptText('');
    setAttachedFiles([]);
    setInputError(null);
    setOliState('idle');
    setBusy(false);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(promptText);
  };

  const currentOrgName = me.data?.org?.name ?? 'Lumen Atlas, empresa de ejemplo';
  const filteredInvoices = PROPOSAL_INVOICES.filter(
    (i) => invoiceFilter === 'all' || i.status === invoiceFilter
  );

  return (
    <div className="proposal-page">
      {/* Top Banner */}
      <div className="proposal-strip">
        <span>
          <strong>Propuesta</strong>
          <span className="strip-detail">Una nueva forma de trabajar con Oli</span>
        </span>
        <span>Datos de ejemplo</span>
      </div>

      {/* Header */}
      <header className="site-header">
        <Link to="/app" className="brand" aria-label="Oli, inicio de la propuesta">
          <span className="brand-mark" aria-hidden="true">
            O
          </span>
          Oli
        </Link>

        <nav className="proposal-nav" aria-label="Navegación principal">
          <a
            href="#inicio"
            className={location.hash !== '#facturas' ? 'nav-active' : ''}
            onClick={(e) => {
              e.preventDefault();
              document.getElementById('inicio')?.scrollIntoView({ behavior: 'smooth' });
              window.history.replaceState(null, '', '#inicio');
            }}
          >
            Tu espacio
          </a>
          <a
            href="#facturas"
            className={location.hash === '#facturas' ? 'nav-active' : ''}
            onClick={(e) => {
              e.preventDefault();
              document.getElementById('facturas')?.scrollIntoView({ behavior: 'smooth' });
              window.history.replaceState(null, '', '#facturas');
            }}
          >
            Facturas
          </a>
          <Link to="/app/rules">Reglas</Link>
          <Link to="/app/approvals">Aprobaciones</Link>
          <Link to="/app/bills" className="back-app">
            Ver app actual <ExternalLink className="icon size-3.5" />
          </Link>
        </nav>

        <div className="header-actions">
          <LanguageSwitcher />
        </div>
      </header>

      {/* Main Container */}
      <main id="inicio">
        {/* Workspace section */}
        <section className={`workspace ${chatActive ? 'chat-active' : ''}`} aria-labelledby="welcome-title">
          <div className="oli-presence">
            <div className="oli-canvas-wrapper">
              <Oli
                state={oliState}
                dark={false}
                speed={0.72}
                particles={2200}
                size={chatActive ? 140 : 210}
                label="Oli, tu asistente de finanzas"
              />
            </div>
          </div>

          <div className="welcome">
            <h1 id="welcome-title">¿Qué resolvemos hoy?</h1>
            <p>Cuéntame qué necesitas. Yo te ayudo con las cuentas.</p>
          </div>

          {/* Conversation history */}
          {chatActive && (
            <section id="conversation" className="conversation" aria-label="Conversación de ejemplo">
              <div className="conversation-top">
                <span>Conversación de ejemplo</span>
                <button type="button" className="text-button" onClick={handleResetChat}>
                  Empezar de nuevo <Plus className="icon size-3.5" />
                </button>
              </div>

              <div id="messages" className="chat-messages" role="log" aria-live="polite">
                {messages.map((m) => (
                  <div key={m.id} className={`message ${m.kind}`}>
                    {m.kind === 'assistant' && (
                      <div className="reply-label">
                        <i />
                        Oli
                      </div>
                    )}
                    {m.text && <p>{m.text}</p>}
                    {m.files && m.files.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {m.files.map((f, idx) => (
                          <div key={idx} className="file-chip">
                            <FileText className="icon size-3.5" />
                            <span className="name">{f.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {m.contentNode}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </section>
          )}

          {/* Composer */}
          <form
            id="composer"
            className={`composer ${isDragging ? 'dragging' : ''}`}
            onSubmit={handleFormSubmit}
            onDragEnter={(e) => {
              e.preventDefault();
              dragCounter.current++;
              setIsDragging(true);
              setOliState('listening');
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
            }}
            onDragLeave={() => {
              dragCounter.current = Math.max(0, dragCounter.current - 1);
              if (!dragCounter.current) setIsDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              dragCounter.current = 0;
              setIsDragging(false);
              handleFilesSelected(e.dataTransfer.files);
            }}
            noValidate
          >
            <label className="sr-only" htmlFor="prompt">
              Escríbele a Oli o adjunta facturas de ejemplo
            </label>
            <textarea
              id="prompt"
              ref={textareaRef}
              rows={2}
              maxLength={1000}
              className="proposal-prompt"
              placeholder={HINTS[hintIndex]}
              value={promptText}
              onChange={(e) => {
                setPromptText(e.target.value);
                setOliState('listening');
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
              }}
              onFocus={() => setOliState('listening')}
              onBlur={() => {
                if (!busy) setOliState('idle');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void ask(promptText);
                }
              }}
              aria-describedby="composer-help"
            />

            {attachedFiles.length > 0 && (
              <div id="attachments" className="attachments" aria-label="Archivos adjuntos">
                {attachedFiles.map((file, idx) => (
                  <div key={idx} className="file-chip">
                    <FileText className="icon size-3.5" />
                    <span className="name">{file.name}</span>
                    <button
                      type="button"
                      aria-label={`Retirar ${file.name}`}
                      onClick={() => removeFile(idx)}
                    >
                      <X className="icon size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="composer-actions">
              <button
                type="button"
                className="attach-button"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="icon size-4" />
                <span>Adjuntar factura</span>
              </button>
              <span className="drop-hint">o arrástrala aquí</span>

              <button
                id="send"
                type="submit"
                className="send-button"
                disabled={busy || (!promptText.trim() && attachedFiles.length === 0)}
                aria-label="Enviar mensaje a Oli"
              >
                <ArrowUp className="icon size-5" />
              </button>
            </div>

            <div className="drop-overlay" aria-hidden="true">
              <Upload className="icon size-7" />
              <strong>Suelta tus facturas aquí.</strong>
              <span>PDF, PNG o JPG · hasta 5 MB por archivo</span>
            </div>
          </form>

          <input
            id="file-picker"
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            multiple
            tabIndex={-1}
            aria-label="Seleccionar facturas de ejemplo"
            onChange={(e) => {
              handleFilesSelected(e.target.files);
              e.target.value = '';
            }}
          />

          <p id="composer-help" className="composer-help">
            Prueba la conversación. Los archivos se quedan en tu navegador.
          </p>

          {inputError && (
            <p id="input-error" className="input-error" role="alert">
              {inputError}
            </p>
          )}

          {!chatActive && (
            <>
              <div className="suggestions" aria-label="Ideas para empezar">
                <button
                  type="button"
                  onClick={() => {
                    void ask('Quiero agregar un proveedor');
                    document.getElementById('inicio')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  <Plus className="icon size-3.5" />
                  Agregar un proveedor
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void ask('¿Cuánto gasté en internet el mes pasado?');
                    document.getElementById('inicio')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  Ver mis gastos de internet <ArrowRight className="icon size-3.5 ml-1" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void ask('¿Qué facturas necesitan mi revisión?');
                    document.getElementById('inicio')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  ¿Qué necesita mi atención? <ArrowRight className="icon size-3.5 ml-1" />
                </button>
              </div>

              <button
                type="button"
                className="attention-note"
                onClick={() => {
                  void ask('¿Por qué está pendiente la factura de Acme Accounting Demo?');
                  document.getElementById('inicio')?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                <span className="attention-dot" aria-hidden="true" />
                <span>Hay una factura que necesita tu visto bueno.</span>
                <ArrowRight className="icon size-3.5" />
              </button>
            </>
          )}
        </section>

        {/* Overview section (#facturas) */}
        <section className="overview" id="facturas" aria-labelledby="overview-title">
          <div className="section-heading">
            <div>
              <h2 id="overview-title">Tus cuentas, a la vista.</h2>
              <p>Octubre de 2026 · {currentOrgName}</p>
            </div>
            <button
              type="button"
              className="outline-button"
              onClick={() => {
                document.getElementById('inicio')?.scrollIntoView({ behavior: 'smooth' });
                fileInputRef.current?.click();
              }}
            >
              <Upload className="icon size-4" />
              Subir factura
            </button>
          </div>

          <div className="overview-grid">
            <section className="invoice-panel" aria-label="Facturas de ejemplo">
              <div className="filters" role="group" aria-label="Filtrar facturas">
                <button
                  type="button"
                  className={invoiceFilter === 'all' ? 'selected' : ''}
                  aria-pressed={invoiceFilter === 'all'}
                  onClick={() => setInvoiceFilter('all')}
                >
                  Todas <span>5</span>
                </button>
                <button
                  type="button"
                  className={invoiceFilter === 'approved' ? 'selected' : ''}
                  aria-pressed={invoiceFilter === 'approved'}
                  onClick={() => setInvoiceFilter('approved')}
                >
                  Aprobadas <span>3</span>
                </button>
                <button
                  type="button"
                  className={invoiceFilter === 'review' ? 'selected' : ''}
                  aria-pressed={invoiceFilter === 'review'}
                  onClick={() => setInvoiceFilter('review')}
                >
                  Por revisar <span>1</span>
                </button>
                <button
                  type="button"
                  className={invoiceFilter === 'blocked' ? 'selected' : ''}
                  aria-pressed={invoiceFilter === 'blocked'}
                  onClick={() => setInvoiceFilter('blocked')}
                >
                  Bloqueadas <span>1</span>
                </button>
              </div>

              <div id="invoice-list" className="invoice-list">
                {filteredInvoices.map((inv) => (
                  <button
                    key={inv.id}
                    type="button"
                    className="invoice-row"
                    onClick={() => {
                      void ask('Explícame la factura de ' + inv.vendor);
                      document.getElementById('inicio')?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    aria-label={`${inv.vendor}, ${money(inv.amount)}, ${
                      inv.status === 'approved' ? 'Aprobada' : inv.status === 'review' ? 'Por revisar' : 'Bloqueada'
                    }. Ver explicación de ejemplo.`}
                  >
                    <span className="invoice-icon">
                      <FileText className="icon size-4" />
                    </span>
                    <span>
                      <span className="vendor-name">{inv.vendor}</span>
                      <span className="invoice-meta">{inv.concept}</span>
                    </span>
                    <span className={`invoice-status ${inv.status}`}>
                      {inv.status === 'approved' && <CheckCircle2 className="icon size-3.5" />}
                      {inv.status === 'review' && <Clock className="icon size-3.5" />}
                      {inv.status === 'blocked' && <Ban className="icon size-3.5" />}
                      {inv.status === 'approved' ? 'Aprobada' : inv.status === 'review' ? 'Por revisar' : 'Bloqueada'}
                    </span>
                    <span className="invoice-amount">${inv.amount.toFixed(2)}</span>
                  </button>
                ))}
              </div>

              <div className="invoice-footer">
                <span>
                  <ShieldCheck className="icon size-3.5" />
                  Las reglas siguen al mando.
                </span>
                <Link to="/app/bills">
                  Abrir vista clásica <ExternalLink className="icon size-3.5 ml-1" />
                </Link>
              </div>
            </section>

            {/* Right Month Panel */}
            <aside className="month-panel" aria-labelledby="month-title">
              <div className="month-heading">
                <h3 id="month-title">Aprobado este mes</h3>
                <span>USD</span>
              </div>
              <p className="month-total">
                449<span>.00</span>
              </p>
              <p className="month-note">Autorizaciones simuladas. Sin mover dinero.</p>

              <figure className="chart">
                <figcaption className="sr-only">
                  Facturas aprobadas de ejemplo: mayo USD310, junio350, julio330, agosto410, septiembre389 y octubre449.
                </figcaption>
                <div className="bars" aria-hidden="true">
                  <div>
                    <span>310</span>
                    <i style={{ '--bar': '62%' } as React.CSSProperties} />
                    <small>May</small>
                  </div>
                  <div>
                    <span>350</span>
                    <i style={{ '--bar': '70%' } as React.CSSProperties} />
                    <small>Jun</small>
                  </div>
                  <div>
                    <span>330</span>
                    <i style={{ '--bar': '66%' } as React.CSSProperties} />
                    <small>Jul</small>
                  </div>
                  <div>
                    <span>410</span>
                    <i style={{ '--bar': '82%' } as React.CSSProperties} />
                    <small>Ago</small>
                  </div>
                  <div>
                    <span>389</span>
                    <i style={{ '--bar': '78%' } as React.CSSProperties} />
                    <small>Sep</small>
                  </div>
                  <div className="current">
                    <span>449</span>
                    <i style={{ '--bar': '90%' } as React.CSSProperties} />
                    <small>Oct</small>
                  </div>
                </div>
              </figure>

              <div className="budget-label">
                <span>Presupuesto disponible</span>
                <strong>USD 1,551</strong>
              </div>
              <meter
                min={0}
                max={2000}
                value={449}
                aria-label="USD449 reservados de USD2000 de presupuesto"
              >
                449 de 2000
              </meter>
              <p className="budget-caption">USD 449 reservados de USD 2,000</p>

              <button
                type="button"
                className="text-button month-question"
                onClick={() => {
                  void ask('Explícame cómo va mi presupuesto este mes');
                  document.getElementById('inicio')?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                <span>Oli, explícame mi mes</span>
                <ArrowRight className="icon size-3.5" />
              </button>
            </aside>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="site-footer">
        <span>Propuesta para conversar con Whady.</span>
        <span>Interacciones demostrativas · Sin cambios en tu cuenta</span>
      </footer>

      {/* Toast */}
      {toastMessage && (
        <div id="toast" className="toast" role="status">
          {toastMessage}
        </div>
      )}
    </div>
  );
}

function VendorInlineForm({
  onConfirmed,
  onCancelled,
}: {
  onConfirmed: (vendor: LocalVendor) => void;
  onCancelled: () => void;
}) {
  const [vendorName, setVendorName] = useState('');
  const [service, setService] = useState('');
  const [step, setStep] = useState<'form' | 'confirm' | 'done'>('form');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!vendorName.trim() || !service.trim()) return;
    setStep('confirm');
  };

  if (step === 'done') {
    return (
      <div>
        <p>
          {vendorName} quedó en la lista de esta propuesta. El siguiente paso sería definir su acuerdo y revisar las reglas.
        </p>
        <p className="answer-note">
          Borrador local. No se creó un proveedor en tu cuenta ni se autorizó ningún pago.
        </p>
      </div>
    );
  }

  if (step === 'confirm') {
    return (
      <div>
        <p>
          De acuerdo: {vendorName}, para {service}. ¿Lo guardamos como borrador?
        </p>
        <div className="reply-actions">
          <button
            type="button"
            className="primary"
            onClick={() => {
              setStep('done');
              onConfirmed({ name: vendorName.trim(), service: service.trim() });
            }}
          >
            Confirmar borrador de ejemplo
          </button>
          <button
            type="button"
            onClick={() => {
              setStep('done');
              onCancelled();
            }}
          >
            Cancelar
          </button>
        </div>
        <p className="answer-note">Solo en esta propuesta. Guardar un proveedor no habilita pagos.</p>
      </div>
    );
  }

  return (
    <div>
      <p>Empecemos por lo esencial. ¿Cómo se llama y qué servicio te presta?</p>
      <form onSubmit={handleSubmit} className="vendor-form">
        <label>
          Nombre del proveedor
          <input
            name="vendor"
            required
            maxLength={80}
            placeholder="Ej. Faro Telecom Demo"
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
          />
        </label>
        <label>
          Servicio
          <input
            name="service"
            required
            maxLength={80}
            placeholder="Ej. Internet de la oficina"
            value={service}
            onChange={(e) => setService(e.target.value)}
          />
        </label>
        <button type="submit" className="inline-primary">
          Preparar proveedor
        </button>
      </form>
      <p className="answer-note">Ejemplo interactivo: no se modificará tu cuenta.</p>
    </div>
  );
}

function InternetAnswer({ september }: { september: typeof INTERNET_SEPTEMBER }) {
  const [compared, setCompared] = useState(false);

  return (
    <div>
      <p>En el ejemplo de {september.period}, tienes una factura de internet:</p>
      <strong className="answer-number">{money(september.amount)}</strong>
      <div className="review-line">
        <span>{september.vendor}</span>
        <small>{september.invoice}</small>
      </div>
      <p className="answer-note">Es el importe facturado y aprobado de ejemplo. No confirma un pago ejecutado.</p>
      {!compared ? (
        <div className="reply-actions">
          <button type="button" onClick={() => setCompared(true)}>
            Comparar con octubre
          </button>
        </div>
      ) : (
        <p className="mt-3">En octubre también son USD 89.00: el importe del servicio no cambió.</p>
      )}
    </div>
  );
}

function InvoiceAnswerCard({
  invoice,
}: {
  invoice: (typeof PROPOSAL_INVOICES)[number];
}) {
  return (
    <div>
      <p>{invoice.vendor}</p>
      <strong className="answer-number">{money(invoice.amount)}</strong>
      <p>{invoice.reason}</p>
      <div className="reply-actions">
        <Link
          to={invoice.status === 'review' ? '/app/approvals' : '/app/bills'}
          className="outline-button"
        >
          {invoice.status === 'review'
            ? 'Ir a aprobaciones de la app actual'
            : 'Abrir facturas de la app actual'}{' '}
          <ExternalLink className="icon ml-1.5 size-3.5" />
        </Link>
      </div>
    </div>
  );
}
