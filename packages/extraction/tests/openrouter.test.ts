import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { EXTRACTION_CONFIG_VERSION, EXTRACTION_MODELS, ExtractionError, extractInvoiceWithOpenRouter } from '../src/openrouter.ts';

const image = new Uint8Array(readFileSync(new URL('../../../fixtures/invoices/001.png', import.meta.url)));
const input = { apiKey: 'test-only-not-a-real-key', documentSha256: 'a'.repeat(64), images: [{ mimeType: 'image/png' as const, bytes: image }] };
const candidate = {
  vendorName: 'Demo vendor', invoiceNumber: 'DEMO-1', amountMinor: 20000, currency: 'USD',
  issuedAt: '2026-10-01', dueDate: '2026-10-31', servicePeriod: null,
  description: 'Servicio ficticio', extractionWarnings: [], evidence: [],
};
const success = (model: string, extraction: unknown = candidate) => Response.json({
  model, provider: 'test-provider', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(extraction && typeof extraction === 'object' && !Array.isArray(extraction) ? { documentType: 'INVOICE', ...extraction } : extraction) } }],
  usage: { prompt_tokens: 1000, completion_tokens: 200, cost: 0.0001 },
});
const modelOf = (init?: RequestInit) => (JSON.parse(String(init?.body)) as { model: string }).model;

test('PDF privado usa file base64 y Mistral OCR, sin reutilizar lectura Cloudflare como evidencia independiente', async () => {
  const bytes = new Uint8Array(readFileSync(new URL('../../../fixtures/invoices/001.pdf', import.meta.url)));
  const result = await extractInvoiceWithOpenRouter({ ...input, images: [], pdf: { bytes } }, { fetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.plugins[0].pdf.engine, 'mistral-ocr');
    assert.equal(body.messages[1].content[1].file.file_data.startsWith('data:application/pdf;base64,'), true);
    return success(body.model);
  } });
  assert.equal(result.extraction.amountMinor, 20000);
  await assert.rejects(extractInvoiceWithOpenRouter({ ...input, images: [], pdf: { bytes: image } }), /INVALID_PDF/);
  await assert.rejects(extractInvoiceWithOpenRouter({ ...input, pdf: { bytes } }), /INVALID_PDF/);
});

test('A lee imagen con schema estricto y sin políticas ni etiquetas de evaluación', async () => {
  const result = await extractInvoiceWithOpenRouter(input, { fetch: async (url, init) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, EXTRACTION_MODELS[0]);
    assert.equal(body.models, undefined, 'el adapter controla sus tres intentos, sin otra cadena oculta');
    assert.equal(body.provider.require_parameters, true);
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.messages[1].content[1].image_url.url.startsWith('data:image/png;base64,'), true);
    assert.equal('expectedExtraction' in body, false);
    assert.equal('policy' in body, false);
    return success(body.model);
  } });
  assert.equal(result.model, EXTRACTION_MODELS[0]);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.extraction.amountMinor, 20000);
  assert.equal(result.usage.costUsd, 0.0001);
  assert.equal('action' in result, false);
});

test('A caído activa B y conserva historial seguro del intento fallido', async () => {
  const seen: string[] = [];
  const result = await extractInvoiceWithOpenRouter(input, { fetch: async (_url, init) => {
    const model = modelOf(init);
    seen.push(model);
    return seen.length === 1 ? new Response('upstream down', { status: 503 }) : success(model);
  } });
  assert.deepEqual(seen, EXTRACTION_MODELS.slice(0, 2));
  assert.equal(result.model, EXTRACTION_MODELS[1]);
  assert.equal(result.attempts[0]!.httpStatus, 503);
});

test('A y B caídos activan C, sin reintentos ilimitados', async () => {
  let count = 0;
  const result = await extractInvoiceWithOpenRouter(input, { fetch: async (_url, init) => {
    count++;
    return count < 3 ? new Response(null, { status: 429 }) : success(modelOf(init));
  } });
  assert.equal(count, 3);
  assert.equal(result.requestedModel, EXTRACTION_MODELS[2]);
  assert.equal(result.attempts.length, 3);
});

test('HTTP 200 con error operativo incrustado activa B sin aceptar contenido parcial', async () => {
  for (const shape of ['top', 'choice']) {
    let calls = 0;
    const error = { code: 502, message: input.apiKey, metadata: { error_type: 'provider_unavailable' } };
    const result = await extractInvoiceWithOpenRouter(input, { fetch: async (_url, init) => {
      if (++calls > 1) return success(modelOf(init));
      return Response.json(shape === 'top' ? { error } : {
        model: EXTRACTION_MODELS[0], choices: [{ error, finish_reason: 'error', message: { content: 'partial output' } }],
      });
    } });
    assert.equal(result.model, EXTRACTION_MODELS[1]);
    assert.equal(result.attempts[0]!.outcome, 'PROVIDER_ERROR');
    assert.equal(result.attempts[0]!.providerErrorCode, 502);
    assert.equal(JSON.stringify(result).includes(input.apiKey), false);
  }
});

test('un rechazo o error no operativo incrustado no activa respaldo', async () => {
  for (const [code, error_type] of [[403, 'refusal'], [502, 'content_policy_violation'], [400, 'invalid_request'], [402, 'payment_required']]) {
    let calls = 0;
    await assert.rejects(extractInvoiceWithOpenRouter(input, { fetch: async () => {
      calls++;
      return Response.json({ error: { code, metadata: { error_type } } });
    } }), ExtractionError);
    assert.equal(calls, 1);
  }
});

test('fallo de red durante lectura del body también activa B', async () => {
  let calls = 0;
  const result = await extractInvoiceWithOpenRouter(input, { fetch: async (_url, init) => {
    if (++calls > 1) return success(modelOf(init));
    return new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('connection lost')); } }));
  } });
  assert.equal(result.model, EXTRACTION_MODELS[1]);
  assert.equal(result.attempts[0]!.outcome, 'NETWORK_ERROR');
});

test('si los tres fallan no hay extracción inventada, decisión ni fuga de la clave', async () => {
  let calls = 0;
  await assert.rejects(extractInvoiceWithOpenRouter(input, { fetch: async () => {
    calls++;
    return new Response('provider diagnostic containing test-only-not-a-real-key', { status: 502 });
  } }), (error: unknown) => {
    assert.ok(error instanceof ExtractionError);
    assert.equal(error.code, 'ALL_MODELS_UNAVAILABLE');
    assert.equal(error.attempts.length, 3);
    assert.equal(JSON.stringify(error).includes(input.apiKey), false);
    assert.equal(String(error).includes(input.apiKey), false);
    return true;
  });
  assert.equal(calls, 3);
});

test('401, falta de saldo y request inválido no gastan tres intentos', async () => {
  for (const status of [400, 401, 402, 403]) {
    let calls = 0;
    await assert.rejects(extractInvoiceWithOpenRouter(input, { fetch: async () => {
      calls++;
      return new Response(null, { status });
    } }), ExtractionError);
    assert.equal(calls, 1);
  }
});

test('un timeout de A permite intentar B', async () => {
  let calls = 0;
  const result = await extractInvoiceWithOpenRouter(input, {
    attemptTimeoutMs: 10, totalTimeoutMs: 1000,
    fetch: async (_url, init) => {
      calls++;
      if (calls > 1) return success(modelOf(init));
      return new Promise<Response>((_resolve, reject) => {
        const keepAlive = setTimeout(() => reject(new Error('test timeout')), 1000);
        init?.signal?.addEventListener('abort', () => { clearTimeout(keepAlive); reject(init.signal?.reason); }, { once: true });
      });
    },
  });
  assert.equal(result.requestedModel, EXTRACTION_MODELS[1]);
  assert.equal(result.attempts[0]!.outcome, 'TIMEOUT');
});

test('C conserva sus 12 segundos aunque A y B consuman sus ventanas completas', async (t) => {
  let now = 0;
  let calls = 0;
  const windows: number[] = [];
  const controllers: AbortController[] = [];
  t.mock.method(Date, 'now', () => now);
  t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    windows.push(milliseconds);
    const controller = new AbortController();
    controllers.push(controller);
    return controller.signal;
  });
  const result = await extractInvoiceWithOpenRouter(input, { fetch: async (_url, init) => {
    if (++calls < 3) {
      now += 12000;
      controllers.at(-1)!.abort();
      throw new Error('simulated timeout');
    }
    return success(modelOf(init));
  } });
  assert.equal(result.requestedModel, EXTRACTION_MODELS[2]);
  assert.deepEqual(windows, [12000, 12000, 12000]);
});

test('un fallo de red permite fallback, una cancelación explícita lo detiene', async () => {
  let calls = 0;
  const result = await extractInvoiceWithOpenRouter(input, { fetch: async (_url, init) => {
    if (++calls === 1) throw new TypeError('Network down');
    return success(modelOf(init));
  } });
  assert.equal(result.requestedModel, EXTRACTION_MODELS[1]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(extractInvoiceWithOpenRouter({ ...input, signal: controller.signal }), (error: unknown) => {
    assert.ok(error instanceof ExtractionError);
    assert.equal(error.code, 'ABORTED');
    return true;
  });
});

test('incertidumbre válida de A nunca se reemplaza por una respuesta más favorable de B', async () => {
  let calls = 0;
  const uncertain = { ...candidate, amountMinor: null, extractionWarnings: ['Total ilegible'] };
  const result = await extractInvoiceWithOpenRouter(input, { fetch: async (_url, init) => {
    calls++;
    return success(modelOf(init), uncertain);
  } });
  assert.equal(calls, 1);
  assert.equal(result.extraction.amountMinor, null);
  assert.deepEqual(result.extraction.extractionWarnings, ['Total ilegible']);
});

test('JSON inválido, output truncado o intento de autorizar del modelo no se ocultan con fallback', async () => {
  for (const [content, finish_reason] of [
    ['not JSON', 'stop'],
    [JSON.stringify({ ...candidate, approved: true }), 'stop'],
    [JSON.stringify(candidate), 'length'],
  ]) {
    let calls = 0;
    await assert.rejects(extractInvoiceWithOpenRouter(input, { fetch: async () => {
      calls++;
      return Response.json({ model: EXTRACTION_MODELS[0], choices: [{ finish_reason, message: { content } }] });
    } }), (error: unknown) => {
      assert.ok(error instanceof ExtractionError);
      assert.equal(error.code, 'INVALID_OUTPUT');
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('rechazo del modelo y respuestas demasiado grandes fallan explícitamente', async () => {
  for (const response of [
    Response.json({ model: EXTRACTION_MODELS[0], choices: [{ finish_reason: 'content_filter', message: { content: null, refusal: 'Cannot process' } }] }),
    new Response('x'.repeat(256 * 1024 + 1)),
  ]) {
    let calls = 0;
    await assert.rejects(extractInvoiceWithOpenRouter(input, { fetch: async () => { calls++; return response; } }), ExtractionError);
    assert.equal(calls, 1);
  }
});

test('sin clave o con imagen/hash inválidos no se hace ninguna llamada', async () => {
  const fetchImpl: typeof fetch = async () => { assert.fail('No debe llamar OpenRouter'); };
  await assert.rejects(extractInvoiceWithOpenRouter({ ...input, apiKey: '' }, { fetch: fetchImpl }), ExtractionError);
  await assert.rejects(extractInvoiceWithOpenRouter({ ...input, documentSha256: '' }, { fetch: fetchImpl }), ExtractionError);
  await assert.rejects(extractInvoiceWithOpenRouter({ ...input, images: [{ mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) }] }, { fetch: fetchImpl }), ExtractionError);
  await assert.rejects(extractInvoiceWithOpenRouter({ ...input, images: [] }, { fetch: fetchImpl }), ExtractionError);
});

test('clasifica rechazo del parser sin exponer mensaje, documento ni credenciales', async () => {
  await assert.rejects(extractInvoiceWithOpenRouter(input, { fetch: async () => new Response(JSON.stringify({
    error: { message: `PDF file parser OCR rate limit exceeded; ${input.apiKey}; private-document-text` },
  }), { status: 400 }) }), (error: unknown) => {
    assert.ok(error instanceof ExtractionError);
    assert.equal(error.code, 'OPENROUTER_REQUEST_REJECTED');
    assert.deepEqual(error.diagnostic, { stage: 'HTTP_ERROR', issueCodes: ['HTTP_400', 'FILE_PARSER_ERROR', 'UPSTREAM_RATE_LIMIT'] });
    assert.equal(JSON.stringify(error).includes(input.apiKey), false);
    assert.equal(JSON.stringify(error).includes('private-document-text'), false);
    return true;
  });
});

test('cada modelo usa su control de razonamiento soportado y un presupuesto de salida acotado', async () => {
  const reasoning: unknown[] = [];
  const result = await extractInvoiceWithOpenRouter(input, { fetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    reasoning.push(body.reasoning);
    assert.equal(body.max_tokens, 4096);
    assert.equal(body.stream, false);
    return reasoning.length < 3 ? new Response(null, { status: 503 }) : success(body.model);
  } });
  assert.deepEqual(reasoning, [{ effort: 'none' }, { effort: 'low' }, { enabled: false }]);
  assert.equal(result.configVersion, EXTRACTION_CONFIG_VERSION);
  assert.deepEqual(result.advisories, []);
});

test('los avisos acotados no descartan incertidumbre ni contaminan el contrato de extracción', async () => {
  let calls = 0;
  const warnings = ['Total ilegible', 'Faltan datos bancarios; el total podría ser 999'];
  const result = await extractInvoiceWithOpenRouter(input, { fetch: async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.response_format.json_schema.schema.properties.advisories.items.enum,
      ['SYNTHETIC_LABEL', 'MISSING_BANK_DETAILS', 'MISSING_TAX_BREAKDOWN']);
    return success(body.model, { ...candidate, amountMinor: null, extractionWarnings: warnings,
      advisories: ['SYNTHETIC_LABEL', 'MISSING_BANK_DETAILS'] });
  } });
  assert.equal(calls, 1);
  assert.equal(result.extraction.amountMinor, null);
  assert.deepEqual(result.extraction.extractionWarnings, warnings);
  assert.deepEqual(result.advisories, ['SYNTHETIC_LABEL', 'MISSING_BANK_DETAILS']);
  assert.equal('advisories' in result.extraction, false);
});

test('avisos libres o etiquetas críticas se rechazan sin buscar otro modelo favorable', async () => {
  for (const advisories of [['TOTAL_CONFLICT'], ['Missing bank details. Total ambiguous'], [{ code: 'MISSING_BANK_DETAILS', text: 'illegible total' }]]) {
    let calls = 0;
    await assert.rejects(extractInvoiceWithOpenRouter(input, { fetch: async (_url, init) => {
      calls++;
      return success(modelOf(init), { ...candidate, advisories });
    } }), (error: unknown) => {
      assert.ok(error instanceof ExtractionError);
      assert.equal(error.code, 'INVALID_OUTPUT');
      assert.equal(JSON.stringify(error).includes('illegible total'), false);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('el diagnóstico de truncamiento conserva tokens de razonamiento sin aceptar ni reparar JSON parcial', async () => {
  let calls = 0;
  await assert.rejects(extractInvoiceWithOpenRouter(input, { fetch: async () => {
    calls++;
    return Response.json({ model: EXTRACTION_MODELS[0],
      choices: [{ finish_reason: 'length', message: { content: '{"vendorName":"secret-document-name"', reasoning: input.apiKey } }],
      usage: { prompt_tokens: 500, completion_tokens: 4096, completion_tokens_details: { reasoning_tokens: 4090 }, cost: 0.01 },
    });
  } }), (error: unknown) => {
    assert.ok(error instanceof ExtractionError);
    assert.deepEqual(error.diagnostic, { stage: 'INVOICE', issueCodes: ['FINISH_length'] });
    assert.equal(error.attempts[0]!.finishReason, 'length');
    assert.deepEqual(error.attempts[0]!.usage, { inputTokens: 500, outputTokens: 4096, reasoningTokens: 4090, costUsd: 0.01 });
    assert.equal(JSON.stringify(error).includes(input.apiKey), false);
    assert.equal(JSON.stringify(error).includes('secret-document-name'), false);
    return true;
  });
  assert.equal(calls, 1);
});

test('clasifica errores anidados del proveedor y no reintenta un 400 con prose arbitraria', async () => {
  for (const raw of [JSON.stringify({ error: { message: `Unsupported parameter response_format; ${input.apiKey}` } }),
    { error: { message: `Unsupported parameter response_format; ${input.apiKey}` } }]) {
    let calls = 0;
    await assert.rejects(extractInvoiceWithOpenRouter(input, { fetch: async () => {
      calls++;
      return Response.json({ error: { code: 400, message: 'Provider returned error', metadata: { raw } } }, { status: 400 });
    } }), (error: unknown) => {
      assert.ok(error instanceof ExtractionError);
      assert.deepEqual(error.diagnostic, { stage: 'HTTP_ERROR', issueCodes: ['HTTP_400', 'UNSUPPORTED_PARAMETER', 'STRUCTURED_OUTPUT_ERROR'] });
      assert.equal(JSON.stringify(error).includes(input.apiKey), false);
      assert.equal(error.attempts[0]!.issueCodes?.includes('UNSUPPORTED_PARAMETER'), true);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('HTTP 400 con error transitorio tipado activa respaldo acotado; prose de rate limit no autoriza reintento', async () => {
  for (const error of [
    { code: 400, metadata: { error_type: 'rate_limit_exceeded' } },
    { code: 400, metadata: { error_type: 'provider_overloaded' } },
    { code: 429 },
  ]) {
    let calls = 0;
    const result = await extractInvoiceWithOpenRouter(input, { fetch: async (_url, init) => ++calls === 1
      ? Response.json({ error }, { status: 400 }) : success(modelOf(init)) });
    assert.equal(calls, 2);
    assert.equal(result.model, EXTRACTION_MODELS[1]);
    assert.ok(result.attempts[0]!.issueCodes?.includes('TRANSIENT_PROVIDER_ERROR'));
  }
  for (const error of [
    { code: 400, message: 'rate limit exceeded; quota unavailable' },
    { code: 429, metadata: { error_type: 'invalid_request' } },
    { code: 400, metadata: { error_type: 'context_length_exceeded' } },
  ]) {
    let calls = 0;
    await assert.rejects(extractInvoiceWithOpenRouter(input, { fetch: async () => {
      calls++; return Response.json({ error }, { status: 400 });
    } }), /OPENROUTER_REQUEST_REJECTED/);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(extractInvoiceWithOpenRouter(input, { fetch: async () => {
    calls++; return Response.json({ error: { code: 400, metadata: { error_type: 'rate_limit_exceeded' } } }, { status: 400 });
  } }), (error: unknown) => {
    assert.ok(error instanceof ExtractionError);
    assert.equal(error.code, 'ALL_MODELS_UNAVAILABLE');
    assert.equal(error.attempts.length, 3);
    return true;
  });
  assert.equal(calls, 3);
});

test('clasificación tipada separa comprobante, factura ambigua y factura; nunca autoriza', async () => {
  for (const documentType of ['PAYMENT_RECEIPT', 'DELIVERY_NOTE', 'INVOICE', 'UNKNOWN'] as const) {
    const result = await extractInvoiceWithOpenRouter(input, { fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.ok(body.response_format.json_schema.schema.required.includes('documentType'));
      return success(body.model, { ...candidate, documentType });
    } });
    assert.equal(result.documentType, documentType);
    assert.equal('documentType' in result.extraction, false);
    assert.equal('action' in result, false);
  }
  for (const value of [undefined, 'APPROVED', { verified: true }]) {
    await assert.rejects(extractInvoiceWithOpenRouter(input, { fetch: async (_url, init) =>
      Response.json({ model: modelOf(init), choices: [{ finish_reason: 'stop', message: {
        content: JSON.stringify({ ...candidate, ...(value === undefined ? {} : { documentType: value }) }),
      } }] }) }), /INVALID_OUTPUT/);
  }
});
