import { describe, expect, it, vi } from 'vitest';
import { submitChat, type Submission } from '../../src/features/chat/submission';
import type { OliApi } from '../../src/api';

function setup(n = 2) {
  const files = Array.from({ length: n }, (_, i) => new File(['%PDF-1.4 test'], `invoice-${i}.pdf`, { type: 'application/pdf' }));
  const operation: Submission = { key: crypto.randomUUID(), text: 'Revisa estas facturas', conversationId: null,
    files: files.map(file => ({ file, key: crypto.randomUUID() })) };
  const api = { uploadInvoice: vi.fn(async (_file: File, key: string) => ({ id: `inv-${key}` })), processInvoice: vi.fn(async () => {}),
    sendChatMessage: vi.fn(async () => ({ text: 'Respuesta del servidor' })) };
  const run = () => submitChat(api as unknown as OliApi, operation, vi.fn());
  return { api, operation, run };
}

describe('Home attachment and message delivery', () => {
  it('waits for real upload receipts and passes only invoice IDs to the chat', async () => {
    const { api, operation, run } = setup();
    await run();
    expect(api.sendChatMessage).toHaveBeenCalledWith({ conversationId: null, text: operation.text,
      invoiceIds: operation.files.map(item => item.invoiceId) }, operation.key);
    expect(api.processInvoice).toHaveBeenCalledTimes(2);
    expect(Object.keys(operation.input!)).toEqual(['conversationId', 'text', 'invoiceIds']);
  });
  it('surfaces a failed upload and does not claim a chat response; retries retain prior receipts and keys', async () => {
    const { api, operation, run } = setup();
    api.uploadInvoice.mockRejectedValueOnce(new Error('upload unavailable'));
    await expect(run()).rejects.toThrow('upload unavailable');
    expect(api.sendChatMessage).not.toHaveBeenCalled();
    const firstKey = operation.files[0]!.key;
    await run();
    expect(api.uploadInvoice.mock.calls[0]![1]).toBe(firstKey);
    expect(api.uploadInvoice.mock.calls[1]![1]).toBe(firstKey);
    expect(api.sendChatMessage).toHaveBeenCalledOnce();
  });
  it('does not upload a successful file again when a later file fails', async () => {
    const { api, run } = setup();
    const normal = api.uploadInvoice.getMockImplementation()!;
    api.uploadInvoice.mockImplementationOnce(normal).mockRejectedValueOnce(new Error('second file failed'));
    await expect(run()).rejects.toThrow('second file failed');
    await run();
    expect(api.uploadInvoice).toHaveBeenCalledTimes(3);
    expect(api.processInvoice).toHaveBeenCalledTimes(2);
  });
  it('retries dispatch using the received invoice without uploading it again', async () => {
    const { api, run } = setup(1);
    api.processInvoice.mockRejectedValueOnce(new Error('dispatch unavailable'));
    await expect(run()).rejects.toThrow('dispatch unavailable'); await run();
    expect(api.uploadInvoice).toHaveBeenCalledOnce(); expect(api.processInvoice).toHaveBeenCalledTimes(2);
  });
  it('replays the identical message body and key after a lost response, without uploading/processing twice', async () => {
    const { api, operation, run } = setup();
    api.sendChatMessage.mockRejectedValueOnce(new Error('lost committed response'));
    await expect(run()).rejects.toThrow('lost committed response');
    const body = JSON.stringify(operation.input);
    await run();
    expect(JSON.stringify(api.sendChatMessage.mock.calls[0])).toBe(JSON.stringify(api.sendChatMessage.mock.calls[1]));
    expect(JSON.stringify(operation.input)).toBe(body);
    expect(api.uploadInvoice).toHaveBeenCalledTimes(2); expect(api.processInvoice).toHaveBeenCalledTimes(2);
  });
  it('recovers a fully prepared command after reload using the same IDs/body/key', async () => {
    const { api, operation } = setup(0);
    operation.input = { conversationId: 'conversation-original', text: 'Mensaje conservado', invoiceIds: ['inv-original'] };
    await submitChat(api as unknown as OliApi, operation, vi.fn());
    expect(api.uploadInvoice).not.toHaveBeenCalled();
    expect(api.sendChatMessage).toHaveBeenCalledWith(operation.input, operation.key);
  });
});
