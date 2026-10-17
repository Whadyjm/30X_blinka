import type { OliApi } from '@/api';
import { validateFile } from '@/features/invoices/useUploadQueue';

export type ChatInput = Parameters<OliApi['sendChatMessage']>[0];
export type Submission = {
  key: string;
  text: string;
  conversationId: string | null;
  files: Array<{ file: File; key: string; invoiceId?: string; dispatched?: boolean }>;
  input?: ChatInput;
};

/** Mutate only the in-flight operation: retries reuse received files and the exact message body/key. */
export async function submitChat(api: OliApi, operation: Submission, checkpoint: () => void) {
  for (const item of operation.files) {
    if (!item.invoiceId) {
      const problem = validateFile(item.file);
      if (problem) throw new Error(problem);
      item.invoiceId = (await api.uploadInvoice(item.file, item.key)).id;
      checkpoint();
    }
    // Upload already commits a durable job; /process asks for immediate dispatch.
    // A dispatch error stays visible; a retry dispatches the same invoice again.
    if (!item.dispatched) { await api.processInvoice(item.invoiceId); item.dispatched = true; }
  }
  operation.input ??= { conversationId: operation.conversationId, text: operation.text,
    invoiceIds: operation.files.map(item => item.invoiceId!) };
  checkpoint();
  return api.sendChatMessage(operation.input, operation.key);
}
