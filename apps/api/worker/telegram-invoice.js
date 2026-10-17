// The recorded decision selects the outcome; this layer only explains it in everyday language.
export function invoiceSummary(invoice) {
  const decision = invoice.latestDecision;
  if (invoice.status === 'FAILED') return 'No pude leer bien este documento. Envíame un PDF o una imagen más clara para intentarlo de nuevo.';
  if (!decision) return 'Estoy revisándola. Te aviso cuando termine.';
  const reasons = decision.reasons ?? [];
  if (decision.action === 'APPROVE') return reasons.includes('HUMAN_APPROVED')
    ? 'Quedó aprobada tras la revisión.' : 'La revisé y cumple con tus reglas. Quedó aprobada.';
  if (decision.action === 'BLOCK') {
    const messages = [
      ['NOT_AN_INVOICE', 'Este documento no parece ser una factura. Lo dejé bloqueado; revisa que hayas enviado el archivo correcto.'],
      ['DUPLICATE_INVOICE', 'La bloqueé porque esta factura ya está registrada. Así evitamos contarla dos veces.'],
      ['HUMAN_REJECTED', 'Quedó rechazada en la revisión. Puedes ver el motivo en Oli.'],
      ['UNKNOWN_VENDOR', 'La bloqueé porque el proveedor no está autorizado en tus reglas.'],
      ['INVALID_CURRENCY', 'La bloqueé porque tus reglas no permiten esta moneda.'],
      ['AMOUNT_ABOVE_HARD_LIMIT', 'La bloqueé porque supera el importe máximo que fijaste.'],
      ['BUDGET_EXCEEDED', 'La bloqueé porque el presupuesto disponible no alcanza para cubrirla.'],
      ['MISSING_BUDGET', 'La dejé bloqueada porque falta un presupuesto vigente para esta moneda.'],
      ['AMOUNT_ABOVE_AUTO_LIMIT', 'La bloqueé porque supera el importe que puedo aprobar con tus reglas actuales.'],
      ['HUMAN_APPROVAL_REQUIRED', 'La dejé bloqueada porque necesita una revisión que tus reglas actuales no permiten.'],
    ];
    return messages.find(([reason]) => reasons.includes(reason))?.[1]
      ?? 'Quedó bloqueada por tus reglas. Abre el detalle para ver el motivo.';
  }
  if (reasons.includes('INVALID_OR_MISSING_DATA')) {
    if (decision.trace?.some(t => t.rule === 'INVOICE_DATES' && t.outcome !== 'PASS')) return 'Hay una fecha que no cuadra. Necesito que revises la emisión y el vencimiento.';
    if (decision.trace?.some(t => t.rule === 'SERVICE_PERIOD' && t.outcome !== 'PASS')) return 'Falta indicar a qué mes corresponde el servicio. Necesito que lo revises antes de continuar.';
    return 'No pude confirmar todos los datos. Necesito que la revises antes de continuar.';
  }
  const messages = [
    ['DOCUMENT_TYPE_UNCERTAIN', 'No pude confirmar que este documento sea una factura. Necesito que lo revises antes de seguir.'],
    ['POSSIBLE_DUPLICATE', 'Se parece a una factura que ya recibí. Necesito que confirmes si es la misma.'],
    ['MISSING_AGREEMENT', 'Necesito que confirmes el acuerdo con este proveedor antes de decidir.'],
    ['AGREEMENT_MISMATCH', 'Hay datos que no coinciden con el acuerdo registrado. Necesito que los revises.'],
  ];
  return messages.find(([reason]) => reasons.includes(reason))?.[1]
    ?? (decision.needsHumanApproval ? 'El importe necesita tu aprobación. Puedes revisarla en Oli.'
      : 'La dejé pendiente de revisión. Abre el detalle para ver qué falta.');
}

export function money(value, currency) {
  const exp = new Intl.NumberFormat('es', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  const base = 10n ** BigInt(exp), n = BigInt(value);
  return `${n / base}${exp ? `.${String(n % base).padStart(exp, '0')}` : ''} ${currency}`;
}
const short = value => Array.from(String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim()).slice(0, 90).join('');
const isOther = invoice => invoice.latestDecision?.reasons?.some(r => ['NOT_AN_INVOICE', 'DOCUMENT_TYPE_UNCERTAIN'].includes(r));
const description = invoice => `${isOther(invoice) ? 'un documento' : 'una factura'}${invoice.vendorName ? ` de ${short(invoice.vendorName)}` : ''}${invoice.amountMinor !== null && invoice.amountMinor !== undefined && invoice.currency ? ` por ${money(invoice.amountMinor, invoice.currency)}` : ''}`;
const button = (env, invoice, index) => [{ text: index === undefined ? isOther(invoice) ? 'Ver documento' : 'Ver factura' : `Ver documento ${index + 1}`,
  url: new URL(`/app/bills/${encodeURIComponent(invoice.id)}`, env.PUBLIC_APP_URL).href }];
const notice = (text, buttons) => [{ text, reply_markup: { inline_keyboard: buttons } }];

export function invoiceNotice(env, invoice, byEmail = false) {
  return notice(`Me llegó${byEmail ? ' por correo' : ''} ${description(invoice)}.\n\n${invoiceSummary(invoice)}`, [button(env, invoice)]);
}

export function emailNotice(env, row, invoices) {
  if (invoices.length === 1) return invoiceNotice(env, invoices[0], true);
  const inbox = [{ text: 'Ver correo en Oli', url: new URL('/app/inbox', env.PUBLIC_APP_URL).href }];
  if (!invoices.length) return notice(row.state === 'NO_DOCUMENT'
    ? 'Me llegó un correo, pero no encontré un PDF, JPG o PNG para revisar. Puedes adjuntar la factura o pegar su imagen en el cuerpo del correo.'
    : 'Me llegó un correo, pero no pude leer sus documentos. Envíamelos de nuevo como PDF, JPG o PNG.', [inbox]);
  return notice(`Me llegaron ${invoices.length} documentos por correo.\n\n${invoices.map((i, index) => `${index + 1}. Recibí ${description(i)}.\n${invoiceSummary(i)}`).join('\n\n')}`,
    [...invoices.map((i, index) => button(env, i, index)), inbox]);
}
