import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

export type GmailEnvelope = {
  id: string;
  from?: string;
  to?: string;
  subject?: string;
  date?: string;
};

export type GmailMessage = GmailEnvelope & {
  body?: string;
  threadId?: string;
};

export type ImapCredentials = {
  user: string;
  password: string;
  host?: string;
  port?: number;
};

export type FetchOptions = {
  sinceDays?: number;
  max?: number;
  mailbox?: string;
};

function headerAddress(value: unknown): string | undefined {
  if (!value) return undefined;
  const v = value as { text?: string };
  return typeof v.text === 'string' && v.text.trim() ? v.text.trim() : undefined;
}

/**
 * Read recent messages from a Gmail mailbox over IMAP.
 *
 * Messages are identified by their Message-ID header rather than the IMAP UID.
 * UIDs are only unique within a mailbox and are reset whenever the server
 * changes UIDVALIDITY, which would break the transactions.source_fingerprint
 * uniqueness the importer relies on to stay idempotent.
 */
export async function fetchRecentMessages(
  credentials: ImapCredentials,
  options: FetchOptions = {}
): Promise<GmailMessage[]> {
  const { sinceDays = 1, max = 200, mailbox = 'INBOX' } = options;

  const client = new ImapFlow({
    host: credentials.host ?? 'imap.gmail.com',
    port: credentials.port ?? 993,
    secure: true,
    auth: { user: credentials.user, pass: credentials.password },
    logger: false,
  });

  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const messages: GmailMessage[] = [];

  await client.connect();
  const lock = await client.getMailboxLock(mailbox, { readOnly: true });

  try {
    for await (const message of client.fetch({ since }, { source: true, uid: true })) {
      if (messages.length >= max) break;
      if (!message.source) continue;

      const parsed = await simpleParser(message.source);

      // Fall back to the UID only when the sender omitted Message-ID. Such
      // messages are rare and the fingerprint stays stable within a mailbox
      // generation, which is the best available guarantee.
      const id = parsed.messageId?.trim() || `uid:${mailbox}:${message.uid}`;

      const body = parsed.text?.trim()
        || parsed.html?.toString().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        || '';

      messages.push({
        id,
        from: headerAddress(parsed.from),
        to: headerAddress(parsed.to),
        subject: parsed.subject?.trim(),
        date: parsed.date?.toISOString(),
        body,
      });
    }
  } finally {
    lock.release();
    await client.logout().catch(() => undefined);
  }

  return messages;
}
