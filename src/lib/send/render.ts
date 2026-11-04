/**
 * Renders one outbound message (OTP + the 7 campaign codes — architecture.md
 * §7 "campaign_sends send-once"; dormant, docs/architecture.md §15) for a given language and
 * channel, from the structured copy in `./templates.ts`.
 *
 * Template selection is (code, lang, channel); each template's numbered
 * `{{1}}`, `{{2}}`, … placeholders are filled from a caller-supplied
 * `vars` record via the template's own `vars: string[]` ordering (see
 * templates.ts's module docstring for the full mapping-per-code rationale).
 * A required var that's absent from `vars` throws `missing_var: <name>` —
 * a broken send (a caller that forgot a link/date/count) must fail loudly
 * rather than ship a template with a literal unfilled `{{2}}` in it.
 */
import { marked } from 'marked';
import type { Lang } from '../../i18n';
import { templates, type TemplateCode, type TemplateChannel } from './templates';

export type SendCode = 'W1' | 'R1' | 'L1' | 'C1' | 'C2' | 'C3' | 'F1';
export type Channel = TemplateChannel;

export interface RenderedMessage {
  subject?: string;
  body: string;
  templateSid?: string;
}

function lookupEntry(code: SendCode | 'OTP', lang: Lang) {
  const byLang = templates[code as TemplateCode];
  const entry = byLang?.[lang];
  if (!entry) {
    throw new Error(`unknown_template: no template for code=${code} lang=${lang}`);
  }
  return entry;
}

function assertVarsPresent(
  vars: Record<string, string>,
  required: string[],
  code: string,
  channel: Channel,
): void {
  for (const name of required) {
    if (vars[name] === undefined) {
      throw new Error(`missing_var: "${name}" is required to render ${code}/${channel}`);
    }
  }
}

/** Replaces every `{{n}}` in `template` with `vars[orderedVarNames[n-1]]`. Assumes vars have already been validated present. */
function interpolate(template: string, orderedVarNames: string[], vars: Record<string, string>): string {
  return template.replace(/\{\{(\d+)\}\}/g, (match, numStr: string) => {
    const varName = orderedVarNames[Number(numStr) - 1];
    if (varName === undefined) return match; // no mapping for this position — leave literal (template/vars mismatch, shouldn't happen with well-formed templates)
    return vars[varName]!;
  });
}

/**
 * Renders `code` (any of the 7 campaign SendCodes, or 'OTP') for `lang` and
 * `channel`, interpolating `vars` (named, not numbered — see templates.ts).
 * Throws `missing_var: …` if a var the template requires wasn't supplied.
 *
 * - `channel: 'email'` -> `{subject, body}`.
 * - `channel: 'whatsapp'` -> `{body, templateSid}` where `templateSid` is
 *   the approved template NAME (`bv_{code}_{name}_{lang}`); production
 *   Twilio sends resolve this name to its Content API SID (or, once that
 *   mapping is wired, this could return the SID directly) and pass the
 *   ordered content variables — see `contentVariablesFor` below for that
 *   ordered-variable form.
 */
export function renderMessage(
  code: SendCode | 'OTP',
  lang: Lang,
  channel: Channel,
  vars: Record<string, string>,
): RenderedMessage {
  const entry = lookupEntry(code, lang);

  if (channel === 'email') {
    const tpl = entry.email;
    assertVarsPresent(vars, tpl.vars, code, channel);
    return {
      subject: interpolate(tpl.subjectTemplate, tpl.vars, vars),
      body: interpolate(tpl.bodyTemplate, tpl.vars, vars),
    };
  }

  const tpl = entry.whatsapp;
  assertVarsPresent(vars, tpl.vars, code, channel);
  return {
    body: interpolate(tpl.bodyTemplate, tpl.vars, vars),
    templateSid: tpl.templateName,
  };
}

/**
 * The WhatsApp template's named vars, in `{{1}}, {{2}}, …` order — used by
 * the send path (`send.ts`) to build Twilio's numbered `ContentVariables`
 * (`{'1': ..., '2': ...}`) from the same named `vars` record passed to
 * `renderMessage`. Throws the same `missing_var` as `renderMessage` if a
 * required var is absent, so a whatsapp send never goes out with a gap.
 */
export function contentVariablesFor(
  code: SendCode | 'OTP',
  lang: Lang,
  vars: Record<string, string>,
): Record<string, string> {
  const entry = lookupEntry(code, lang);
  const tpl = entry.whatsapp;
  assertVarsPresent(vars, tpl.vars, code, 'whatsapp');

  const result: Record<string, string> = {};
  tpl.vars.forEach((name, i) => {
    result[String(i + 1)] = vars[name]!;
  });
  return result;
}

/**
 * Converts an EMAIL body's Markdown — every `EmailTemplate.bodyTemplate` in
 * templates.ts is Markdown (**bold**,
 * `- bullets`, `[text](url)`, backtick-code) — into HTML, for send.ts to pass
 * as SendGrid's `text/html` content. Without this conversion a recipient
 * sees literal `**`/`[..](..)` characters instead of formatting (Task 52
 * review finding).
 *
 * Deliberately uses `marked` directly rather than
 * `src/lib/render-content.ts`'s `renderContentHtml` — that helper strips
 * `<!-- INPUT NEEDED -->`-style authoring comments and rewrites
 * root-relative links through `localePath()`, both tailored to on-site
 * editorial content and not what an email body needs (its links are already
 * absolute `https://...` URLs baked into `vars`, not root-relative). Calling
 * `marked` directly with no `sanitize`/raw-HTML option enabled is safe here
 * for the same reason it's safe in render-content.ts: the Markdown is
 * repo-authored (templates.ts), never user input.
 */
export function renderEmailMarkdown(markdown: string): string {
  return marked.parse(markdown, { gfm: true, async: false }) as string;
}
