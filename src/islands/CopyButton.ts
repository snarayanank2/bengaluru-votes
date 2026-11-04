/**
 * CopyButton — progressive enhancement over readonly `<input>`/`<textarea>`
 * copy blocks on the partner kit page (`/partner/{slug}`, Task 48:
 * the tagged link + each WhatsApp forward-text block). Every field
 * this button targets is a real readonly input/textarea that already works
 * with zero JS (select-all + Ctrl/Cmd+C) — this only adds a one-tap
 * `navigator.clipboard.writeText` shortcut on top, plus a brief "Copied"
 * confirmation on the button itself and via a shared `aria-live` status
 * region (`#copy-status`, if present on the page).
 *
 * This is a plain, non-inline, bundled-and-hashed script (imported from a
 * page's own `<script>` tag, same pattern as src/islands/BoothLookup.ts /
 * initBoothLookup) — never an inline nonce'd script. An inline script would
 * embed the request's per-response CSP nonce into the HTML, which would
 * make the page vary per-request and break its cache-safety
 * (architecture.md §5); this module carries no per-request data at all.
 *
 * On any failure — an older browser without the Clipboard API, permission
 * denial, a non-secure context — this fails silently and leaves the
 * underlying field exactly as usable as it already was (falls back to
 * selecting the field's text so a manual Ctrl/Cmd+C still works); there is
 * no broken state to recover from because nothing was ever disabled.
 */

const COPIED_RESET_MS = 2000;

function isCopyableField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

export function initCopyButtons(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>('[data-copy-button]');
  const status = document.getElementById('copy-status');

  buttons.forEach((button) => {
    const targetId = button.getAttribute('data-copy-target');
    const field = targetId ? document.getElementById(targetId) : null;
    if (!isCopyableField(field)) return;

    const defaultLabel = button.textContent ?? '';
    const copiedLabel = button.getAttribute('data-copy-label-copied') || defaultLabel;
    let resetTimer: ReturnType<typeof setTimeout> | undefined;

    button.addEventListener('click', () => {
      const text = field.value;

      if (!navigator.clipboard?.writeText) {
        field.select();
        return;
      }

      navigator.clipboard
        .writeText(text)
        .then(() => {
          button.textContent = copiedLabel;
          if (status) status.textContent = copiedLabel;
          if (resetTimer) clearTimeout(resetTimer);
          resetTimer = setTimeout(() => {
            button.textContent = defaultLabel;
          }, COPIED_RESET_MS);
        })
        .catch(() => {
          field.select();
        });
    });
  });
}
