#!/usr/bin/env tsx
/**
 * Queues every PDF in a directory for extraction, as the bulk alternative
 * to the upload form on /admin/affidavits. Makes no API calls: it only
 * stores the files and queues them (src/lib/affidavit-queue.ts); the
 * `extract-worker` container does the reading.
 *
 *   npm run upload:affidavits -- <directory> --as <admin email>
 *
 * Safe to rerun: a PDF that is already stored is reported as a duplicate
 * and skipped. `--as` names the admin account recorded as the uploader.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { eq } from 'drizzle-orm';

const USAGE = 'Usage: npm run upload:affidavits -- <directory> --as <admin email>';

export function parseArgs(argv: string[]): { dir: string; email: string } | null {
  const asIndex = argv.indexOf('--as');
  const email = asIndex >= 0 ? argv[asIndex + 1] : undefined;
  const rest = argv.filter((_, i) => i !== asIndex && i !== asIndex + 1);
  if (!email || email.startsWith('--') || rest.length !== 1) return null;
  return { dir: rest[0], email: email.trim().toLowerCase() };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error(USAGE);
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  // Imported here so `parseArgs` can be tested without a database.
  const { db } = await import('../src/db/client');
  const { users } = await import('../src/db/schema');
  const { enqueueAffidavit } = await import('../src/lib/affidavit-queue');

  const [admin] = await db.select({ id: users.id, role: users.role, status: users.status }).from(users).where(eq(users.email, args.email));
  if (!admin || admin.role !== 'admin' || admin.status !== 'active') {
    console.error(`No active admin account with email ${args.email}.`);
    process.exit(1);
  }

  const files = readdirSync(args.dir)
    .filter((name) => name.toLowerCase().endsWith('.pdf'))
    .sort();
  const tally = { queued: 0, duplicate: 0, rejected: 0 };
  for (const name of files) {
    const result = await enqueueAffidavit(readFileSync(path.join(args.dir, name)), { uploadedBy: admin.id });
    tally[result.kind] += 1;
    console.log(`${result.kind.padEnd(9)} ${name}${result.kind === 'rejected' ? ` (${result.reason})` : ''}`);
  }
  console.log(`\n${files.length} PDFs: ${tally.queued} queued, ${tally.duplicate} already stored, ${tally.rejected} rejected.`);

  await db.$client.end({ timeout: 5 });
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
