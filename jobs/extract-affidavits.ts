#!/usr/bin/env tsx
/**
 * The affidavit extraction worker: a long-running process, not a cron
 * entry. It runs `EXTRACTION_CONCURRENCY` loops, each claiming one queued
 * affidavit at a time (src/lib/affidavit-queue.ts) and reading it with
 * `EXTRACTION_MODEL`.
 *
 * Safe to run more than one of, and safe to kill: a claim is a lease, so an
 * affidavit a dead worker held is claimable again fifteen minutes later.
 * On SIGTERM it stops claiming and lets the calls in flight finish.
 *
 * Without `ANTHROPIC_API_KEY` it exits non-zero at once and leaves the
 * queue untouched, rather than burning every affidavit's attempts on calls
 * that cannot succeed.
 */
import { pathToFileURL } from 'node:url';
import { db } from '../src/db/client';
import { EXTRACTION_MODELS, extractAffidavit, type ExtractionModel } from '../src/lib/affidavit-extraction';
import { processOne } from '../src/lib/affidavit-queue';
import { logEvent } from '../src/lib/log';
import { captureException } from '../src/lib/logger';

const IDLE_MS = 5000;

function configuredModel(): ExtractionModel {
  const raw = process.env.EXTRACTION_MODEL ?? 'claude-opus-5-5';
  if (!(EXTRACTION_MODELS as readonly string[]).includes(raw)) {
    throw new Error(`EXTRACTION_MODEL must be one of ${EXTRACTION_MODELS.join(', ')}; got "${raw}"`);
  }
  return raw as ExtractionModel;
}

function configuredConcurrency(): number {
  const raw = process.env.EXTRACTION_CONCURRENCY ?? '10';
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw new Error(`EXTRACTION_CONCURRENCY must be a whole number from 1 to 50; got "${raw}"`);
  }
  return value;
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('extract-affidavits: ANTHROPIC_API_KEY is not set; queued affidavits are left untouched.');
    process.exit(1);
  }
  const model = configuredModel();
  const concurrency = configuredConcurrency();

  let stopping = false;
  let wake: (() => void) | undefined;
  const stop = () => {
    stopping = true;
    wake?.();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  const idle = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, IDLE_MS);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  logEvent('extract_worker_started', { model, concurrency });

  const loop = async () => {
    while (!stopping) {
      try {
        const worked = await processOne((pdf) => extractAffidavit(pdf, model));
        if (!worked && !stopping) await idle();
      } catch (err) {
        // Only the claim itself can throw here (the database is away); wait and try again.
        captureException(err);
        if (!stopping) await idle();
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, loop));

  logEvent('extract_worker_stopped', {});
  await db.$client.end({ timeout: 5 });
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
