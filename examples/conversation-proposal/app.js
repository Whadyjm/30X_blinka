import { OliCanvas } from '../../packages/oli/src/renderer.js';
import { invoices, internetSeptember, budget, hints, intentFor, validateAttachments } from './model.mjs';

const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const icon = name => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'icon'); svg.setAttribute('aria-hidden', 'true'); const use = document.createElementNS(svg.namespaceURI, 'use'); use.setAttribute('href', '#i-' + name); svg.append(use); return svg; };
const money = n => 'USD ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const prompt = $('#prompt');
const files = [];
const vendors = [];
let busy = false, epoch = 0, hintIndex = 0, toastTimer;
let oli;
try { oli = new OliCanvas($('#oli'), { state: 'idle', dark: false, speed: .72, particles: 2200 }); }
catch { $('#oli').setAttribute('aria-label', 'Oli. Animación no disponible en este navegador.'); }
const pose = state => oli?.setState(state);
const updateSend = () => { $('#send').disabled = busy || (!prompt.value.trim() && !files.length); $('#send').setAttribute('aria-label', busy ? 'Preparando respuesta de ejemplo' : 'Enviar mensaje a Oli'); $('#composer').setAttribute('aria-busy', String(busy)); };

function notice(text) { $('#toast').textContent = text; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500); }
function action(text, callback, primary = false) { const b = el('button', primary ? 'primary' : '', text); b.type = 'button'; b.addEventListener('click', callback); return b; }
function classicAction(container, text, path) { const a = el('a', 'outline-button', text); a.href = path; a.append(icon('external')); container.append(a); }
function message(kind, text) {
  const box = el('div', 'message ' + kind);
  if (kind === 'assistant') { const label = el('div', 'reply-label'); label.append(el('i'), document.createTextNode('Oli')); box.append(label); }
  if (text) box.append(el('p', '', text));
  $('#messages').append(box); $('#messages').scrollTop = $('#messages').scrollHeight; return box;
}
function activateChat() {
  $('.workspace').classList.add('chat-active'); $('#conversation').hidden = false;
}
function renderFiles() {
  $('#attachments').replaceChildren();
  files.forEach((file, index) => {
    const chip = el('div', 'file-chip'); chip.append(icon('file'), el('span', 'name', file.name));
    const remove = action('', () => { files.splice(index, 1); renderFiles(); updateSend(); });
    remove.setAttribute('aria-label', 'Retirar ' + file.name); remove.append(icon('close')); chip.append(remove); $('#attachments').append(chip);
  });
}
function addFiles(selected) {
  const additions = Array.from(selected); if (!additions.length) return;
  const error = validateAttachments(additions, files.length); $('#input-error').hidden = !error; $('#input-error').textContent = error ?? '';
  if (error) return;
  files.push(...additions); renderFiles(); updateSend(); pose('understanding');
  notice(additions.length === 1 ? 'Factura adjunta. Envíala cuando quieras.' : `${additions.length} facturas adjuntas. Puedes enviarlas juntas.`);
}

function vendorForm(box) {
  box.append(el('p', '', 'Empecemos por lo esencial. ¿Cómo se llama y qué servicio te presta?'));
  const form = el('form', 'vendor-form');
  const field = (text, name, placeholder) => { const label = el('label', '', text); const input = el('input'); input.name = name; input.required = true; input.maxLength = 80; input.placeholder = placeholder; label.append(input); form.append(label); return input; };
  const name = field('Nombre del proveedor', 'vendor', 'Ej. Faro Telecom Demo');
  const service = field('Servicio', 'service', 'Ej. Internet de la oficina');
  const button = el('button', 'inline-primary', 'Preparar proveedor'); button.type = 'submit'; form.append(button);
  form.addEventListener('submit', event => {
    event.preventDefault(); name.setCustomValidity(name.value.trim() ? '' : 'Escribe el nombre del proveedor.'); service.setCustomValidity(service.value.trim() ? '' : 'Escribe el servicio.');
    if (!form.reportValidity()) return;
    const vendor = { name: name.value.trim(), service: service.value.trim() }; form.remove();
    box.append(el('p', '', `De acuerdo: ${vendor.name}, para ${vendor.service}. ¿Lo guardamos como borrador?`));
    const controls = el('div', 'reply-actions');
    controls.append(action('Confirmar borrador de ejemplo', () => { vendors.push(vendor); controls.remove(); box.append(el('p', '', `${vendor.name} quedó en la lista de esta propuesta. El siguiente paso sería definir su acuerdo y revisar las reglas.`)); box.append(el('p', 'answer-note', 'Borrador local.')); pose('happy'); notice('Borrador de ejemplo confirmado.'); }, true), action('Cancelar', () => { controls.remove(); box.append(el('p', '', 'Lo dejamos aquí. No se guardó el borrador.')); pose('idle'); }));
    box.append(controls, el('p', 'answer-note', 'Solo en esta propuesta. Guardar un proveedor no habilita pagos.')); $('#messages').scrollTop = $('#messages').scrollHeight;
  });
  for (const input of [name, service]) input.addEventListener('input', () => input.setCustomValidity(''));
  box.append(form, el('p', 'answer-note', 'Ejemplo interactivo: no se modificará tu cuenta.'));
}
function invoiceAnswer(box, row) {
  box.append(el('p', '', row.vendor), el('strong', 'answer-number', money(row.amount)), el('p', '', row.reason));
  const controls = el('div', 'reply-actions'); classicAction(controls, row.status === 'review' ? 'Ir a aprobaciones de la app actual' : 'Abrir facturas de la app actual', row.status === 'review' ? '/app/approvals' : '/app/bills'); box.append(controls);
}
function answer(text, attachments) {
  const box = message('assistant');
  if (attachments.length) {
    box.append(el('p', '', `${attachments.length === 1 ? 'Tienes un archivo listo' : `Tienes ${attachments.length} archivos listos`} para revisar.`));
    for (const file of attachments) { const line = el('div', 'review-line'); line.append(el('span', '', file.name), el('small', '', Math.ceil(file.size / 1024) + ' KB')); box.append(line); }
    box.append(el('p', 'answer-note', 'En esta propuesta no se leen ni se suben los archivos. En el flujo conectado, Oli extraería los datos, comprobaría las reglas y registraría una decisión.'));
    const controls = el('div', 'reply-actions'); classicAction(controls, 'Probar una carga real en la app actual', '/app/bills'); box.append(controls); return;
  }
  switch (intentFor(text)) {
    case 'add-vendor': vendorForm(box); break;
    case 'vendors':
      box.append(el('p', '', vendors.length ? 'Estos son los borradores que añadiste en esta propuesta:' : 'Todavía no añadiste proveedores en esta propuesta. Podemos preparar el primero.'));
      for (const v of vendors) box.append(el('p', '', `${v.name} · ${v.service}`));
      { const controls = el('div', 'reply-actions'); controls.append(action('Agregar proveedor', () => ask('Quiero agregar un proveedor'))); box.append(controls); } break;
    case 'internet': {
      box.append(el('p', '', `En el ejemplo de ${internetSeptember.period}, tienes una factura de internet:`), el('strong', 'answer-number', money(internetSeptember.amount)));
      const line = el('div', 'review-line'); line.append(el('span', '', internetSeptember.vendor), el('small', '', internetSeptember.invoice)); box.append(line, el('p', 'answer-note', 'Importe facturado y aprobado.'));
      const controls = el('div', 'reply-actions'); controls.append(action('Comparar con octubre', () => { box.append(el('p', '', 'En octubre también son USD 89.00: el importe del servicio no cambió.')); controls.remove(); })); box.append(controls); break;
    }
    case 'budget':
      box.append(el('p', '', 'Tu ejemplo de octubre tiene margen para seguir operando.'), el('strong', 'answer-number', money(budget.total - budget.reserved) + ' disponibles'), el('p', '', `Hay ${money(budget.reserved)} reservados de un presupuesto de ${money(budget.total)}. La factura pendiente de USD 450 todavía no consume presupuesto. La duplicada de USD 120 está bloqueada.`)); break;
    case 'blocked': invoiceAnswer(box, invoices.find(i => i.id === 'pixel')); break;
    case 'cloud': invoiceAnswer(box, invoices.find(i => i.id === 'cloud')); break;
    case 'linea': invoiceAnswer(box, invoices.find(i => i.id === 'linea')); break;
    case 'fibra': invoiceAnswer(box, invoices.find(i => i.id === 'fibra')); break;
    case 'review': invoiceAnswer(box, invoices.find(i => i.id === 'acme')); break;
    case 'upload': box.append(el('p', '', 'Puedes adjuntar un PDF, PNG o JPG desde el clip, o arrastrarlo al campo de mensaje. Hasta 4 archivos de 5 MB por vez.'), el('p', 'answer-note', 'La propuesta muestra cómo sería la interacción. Para procesar documentos usa la app actual.')); break;
    default: {
      box.append(el('p', '', 'Esta propuesta tiene tres recorridos para explorar: preparar un proveedor, consultar internet o revisar una factura pendiente. ¿Por cuál empezamos?'));
      const controls = el('div', 'reply-actions'); for (const [label, query] of [['Proveedor', 'Quiero agregar un proveedor'], ['Internet', 'Gastos de internet'], ['Pendientes', 'Facturas pendientes']]) controls.append(action(label, () => ask(query))); box.append(controls); break;
    }
  }
}

async function ask(text) {
  if (busy) return;
  const query = text.trim(); const attached = files.splice(0); if (!query && !attached.length) return;
  busy = true; const turn = epoch; activateChat();
  message('user', query || (attached.length === 1 ? 'Revisemos esta factura.' : 'Revisemos estas facturas.'));
  prompt.value = ''; prompt.style.height = ''; prompt.placeholder = 'Escríbele a Oli…'; renderFiles(); updateSend(); pose('thinking');
  const pending = message('assistant', 'Un momento…'); pending.setAttribute('aria-busy', 'true');
  await new Promise(resolve => setTimeout(resolve, matchMedia('(prefers-reduced-motion: reduce)').matches ? 80 : 650));
  if (turn !== epoch) return;
  pending.remove(); answer(query, attached); busy = false; updateSend(); pose('understanding');
  $('#messages').scrollTop = $('#messages').scrollHeight;
}

function renderInvoices(filter = 'all') {
  $('#invoice-list').replaceChildren();
  for (const row of invoices.filter(i => filter === 'all' || i.status === filter)) {
    const button = el('button', 'invoice-row'); button.type = 'button';
    const fileIcon = el('span', 'invoice-icon'); fileIcon.append(icon('file'));
    const identity = el('span'); identity.append(el('span', 'vendor-name', row.vendor), el('span', 'invoice-meta', row.concept));
    const status = el('span', 'invoice-status ' + row.status); status.append(icon({ approved: 'check', review: 'clock', blocked: 'block' }[row.status]), document.createTextNode({ approved: 'Aprobada', review: 'Por revisar', blocked: 'Bloqueada' }[row.status]));
    button.append(fileIcon, identity, status, el('span', 'invoice-amount', '$' + row.amount.toFixed(2)));
    button.setAttribute('aria-label', `${row.vendor}, ${money(row.amount)}, ${status.textContent}. Ver explicación de ejemplo.`);
    button.addEventListener('click', () => { if (busy) return; ask('Explícame la factura de ' + row.vendor); $('#inicio').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }); $('#invoice-list').append(button);
  }
}
renderInvoices();
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-filter]').forEach(b => { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button)); }); renderInvoices(button.dataset.filter);
}));
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => { if (busy) return; ask(button.dataset.prompt); $('#inicio').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }));
$('#composer').addEventListener('submit', event => { event.preventDefault(); ask(prompt.value); });
prompt.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); ask(prompt.value); } });
prompt.addEventListener('input', () => { updateSend(); prompt.style.height = 'auto'; prompt.style.height = Math.min(prompt.scrollHeight, 160) + 'px'; pose('listening'); });
prompt.addEventListener('focus', () => pose('listening'));
prompt.addEventListener('blur', () => { if (!busy) pose('idle'); });
$('#attach').addEventListener('click', () => $('#file-picker').click());
$('#classic-upload').addEventListener('click', () => { $('#inicio').scrollIntoView({ behavior: 'smooth' }); $('#file-picker').click(); });
$('#file-picker').addEventListener('change', event => { addFiles(event.target.files); event.target.value = ''; });
let dragDepth = 0;
$('#composer').addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; $('#composer').classList.add('dragging'); pose('listening'); });
$('#composer').addEventListener('dragover', event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; });
$('#composer').addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#composer').classList.remove('dragging'); });
$('#composer').addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; $('#composer').classList.remove('dragging'); addFiles(event.dataTransfer.files); });
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());
$('#reset-chat').addEventListener('click', () => { epoch++; busy = false; $('#messages').replaceChildren(); $('#conversation').hidden = true; $('.workspace').classList.remove('chat-active'); prompt.value = ''; prompt.placeholder = hints[hintIndex]; files.splice(0); renderFiles(); updateSend(); $('#input-error').hidden = true; pose('idle'); prompt.focus(); });
const hintTimer = setInterval(() => { if (document.hidden || prompt.value || document.activeElement === prompt || $('.workspace').classList.contains('chat-active') || matchMedia('(prefers-reduced-motion: reduce)').matches) return; prompt.placeholder = hints[++hintIndex % hints.length]; }, 4500);
window.addEventListener('pagehide', () => { clearInterval(hintTimer); clearTimeout(toastTimer); oli?.destroy(); }, { once: true });
