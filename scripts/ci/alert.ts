/**
 * Failure email for the deploy workflow, sent through SendGrid (the app's own
 * mail vendor). Sending must never mask the failure it reports: sendAlert
 * returns false instead of throwing, and never logs the API key.
 */
import { pathToFileURL } from 'node:url';

export type AlertKind = 'test-failed' | 'deploy-failed' | 'rolled-back' | 'rollback-failed';
export interface Failure { kind: AlertKind; commit: string; tag?: string; step?: string; runUrl: string }

const SUBJECTS: Record<AlertKind, string> = {
  'test-failed': 'bengaluru-votes: main is RED — tests failed, nothing deployed',
  'deploy-failed': 'bengaluru-votes: deploy FAILED (old version still serving)',
  'rolled-back': 'bengaluru-votes: deploy failed and was ROLLED BACK',
  'rollback-failed': 'bengaluru-votes: ROLLBACK FAILED — production may be down',
};

export function buildAlert(f: Failure): { subject: string; text: string } {
  const text = [
    SUBJECTS[f.kind],
    '',
    `Commit: ${f.commit}`,
    `Tag:    ${f.tag ?? '(none created)'}`,
    `Step:   ${f.step ?? '(unknown)'}`,
    `Run:    ${f.runUrl}`,
  ].join('\n');
  return { subject: SUBJECTS[f.kind], text };
}

type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;

export async function sendAlert(
  msg: { subject: string; text: string },
  env: Record<string, string | undefined>,
  fetchFn: FetchFn = fetch as unknown as FetchFn,
): Promise<boolean> {
  const { SENDGRID_API_KEY: key, SENDGRID_FROM_EMAIL: from, DEPLOY_ALERT_EMAIL: to } = env;
  if (!key || !from || !to) {
    console.warn('alert: SENDGRID_API_KEY, SENDGRID_FROM_EMAIL or DEPLOY_ALERT_EMAIL is not set; no email sent');
    return false;
  }
  try {
    const res = await fetchFn('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from },
        subject: msg.subject,
        content: [{ type: 'text/plain', value: msg.text }],
      }),
    });
    if (!res.ok) console.warn(`alert: SendGrid answered ${res.status}; no email sent`);
    return res.ok;
  } catch (e) {
    console.warn(`alert: could not reach SendGrid (${(e as Error).name}); no email sent`);
    return false;
  }
}

async function main(): Promise<void> {
  const e = process.env;
  const kind = e.ALERT_KIND as AlertKind;
  if (!(kind in SUBJECTS)) throw new Error(`ALERT_KIND must be one of ${Object.keys(SUBJECTS).join(', ')}`);
  const ok = await sendAlert(
    buildAlert({ kind, commit: e.ALERT_COMMIT ?? '', tag: e.ALERT_TAG || undefined, step: e.ALERT_STEP || undefined, runUrl: e.ALERT_RUN_URL ?? '' }),
    e,
  );
  if (!ok) console.warn('alert: email not delivered; the red workflow run and GitHub notifications are the backstop');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
