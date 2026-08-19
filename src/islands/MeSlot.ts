/**
 * MeSlot — Task 28, architecture.md §5's cache invariant / §4. Public page
 * HTML never varies by session; this island is the ONLY thing that
 * personalizes a page, and it does so with exactly ONE
 * `fetch('/api/me')` per page load (`getMe()` below caches the promise so
 * every slot on a page shares the same in-flight/settled request — never
 * one fetch per personalized element).
 *
 * Mounted from `src/layouts/Base.astro`, so it runs on every page. Swaps up
 * to three elements, purely client-side, once `/api/me` resolves:
 *
 *   1. App bar `[data-me-slot]` (src/components/AppBar.astro) — anonymous:
 *      left exactly as the server rendered it (still opens the
 *      Register/Login modal via src/islands/RegisterLoginModal.ts's own
 *      wiring). Authed: swapped for a plain "Account" link to
 *      `/account` (or `/kn/account`), labelled from that element's own
 *      `data-msg-account` attribute (server-localized string — this module
 *      never imports the full i18n table, matching the convention in
 *      src/islands/WardLookup.ts).
 *   2. Register-for-updates slot `[data-register-slot][data-ward-id]`
 *      (Ward.astro) — anonymous: left alone. Authed AND
 *      this ward === the user's `homeWardId`: swapped for a plain
 *      "Receiving updates" status (`data-msg-receiving-updates`) — no
 *      longer a control, nothing to tap. Authed on any OTHER ward: removed
 *      entirely (IA §3.2 — home-ward switching lives on `/account` only).
 *   3. Already-voted hint on `[data-vote-action][data-ward-id]`
 *      (Ward.astro) — authed AND this ward === `alreadyVotedWardId`:
 *      marked `data-already-voted` for Task 33's Cast-issue-vote modal to
 *      read. Deliberately minimal (a hint, not a swap) per the task brief.
 *
 * SWAP MECHANISM: each swap uses `element.cloneNode(false)` (attributes
 * only, no children/listeners) then `replaceWith` — this drops whatever
 * click listener src/islands/RegisterLoginModal.ts may have already
 * attached directly to that DOM node (attribute removal alone would NOT do
 * this: a listener bound via `addEventListener` stays bound to the node
 * object regardless of which attributes are still present on it), while
 * preserving the node's class list and Astro's scoped-style attribute so
 * the swapped-in element keeps the same look with no layout shift. Works
 * regardless of which island's `<script>` runs first.
 *
 * GRACEFUL FAILURE: any fetch/parse error (`getMe()` -> `null`) or an
 * `{anonymous:true}` response leaves every element exactly as the server
 * rendered it. A broken/offline `/api/me` must never break the page — only
 * leave it unpersonalized.
 */

export type MeResponse =
  | { anonymous: true }
  | {
      anonymous: false;
      userId: number;
      role: string;
      homeWardId: number | null;
      language: string;
      alreadyVotedWardId: number | null;
    };

let mePromise: Promise<MeResponse | null> | null = null;

async function fetchMe(): Promise<MeResponse | null> {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) return null;
    return (await res.json()) as MeResponse;
  } catch {
    return null;
  }
}

/**
 * The single, page-lifetime-cached `/api/me` result — created on the first
 * call and reused by every subsequent call, so N personalized elements on
 * one page never cause N network requests.
 */
function getMe(): Promise<MeResponse | null> {
  if (!mePromise) mePromise = fetchMe();
  return mePromise;
}

function localizedAccountHref(): string {
  return document.documentElement.lang === 'kn' ? '/kn/account' : '/account';
}

function swapToAccountLink(el: HTMLElement): void {
  const label = el.dataset.msgAccount ?? '';
  const clone = el.cloneNode(false) as HTMLElement;
  clone.removeAttribute('data-me-slot');
  clone.removeAttribute('data-msg-account');
  clone.setAttribute('href', localizedAccountHref());
  clone.textContent = label;
  el.replaceWith(clone);
}

function swapRegisterSlot(el: HTMLElement, homeWardId: number | null): void {
  const wardId = Number(el.dataset.wardId);
  if (!Number.isFinite(wardId)) return;

  if (homeWardId === wardId) {
    const label = el.dataset.msgReceivingUpdates ?? '';
    const clone = el.cloneNode(false) as HTMLElement;
    clone.removeAttribute('href');
    clone.removeAttribute('data-register-slot');
    clone.removeAttribute('data-msg-receiving-updates');
    clone.textContent = label;
    el.replaceWith(clone);
  } else {
    // A visitor viewing any OTHER ward sees nothing here (IA §3.2) — home
    // ward switching lives on /account only.
    el.remove();
  }
}

function markAlreadyVoted(el: HTMLElement, alreadyVotedWardId: number | null): void {
  const wardId = Number(el.dataset.wardId);
  if (Number.isFinite(wardId) && alreadyVotedWardId === wardId) {
    el.setAttribute('data-already-voted', 'true');
  }
}

/**
 * Finds whichever personalized elements are present on THIS page (never all
 * three — most pages have at most the app-bar slot) and swaps them once
 * `/api/me` resolves. Safe no-op if none are present, and safe/graceful if
 * the fetch fails.
 */
export async function initMeSlot(root: ParentNode = document): Promise<void> {
  const meSlotEl = root.querySelector<HTMLElement>('[data-me-slot]');
  const registerSlotEl = root.querySelector<HTMLElement>('[data-register-slot]');
  const voteActionEl = root.querySelector<HTMLElement>('[data-vote-action]');

  if (!meSlotEl && !registerSlotEl && !voteActionEl) return;

  const me = await getMe();
  if (!me || me.anonymous) return;

  if (meSlotEl) swapToAccountLink(meSlotEl);
  if (registerSlotEl) swapRegisterSlot(registerSlotEl, me.homeWardId);
  if (voteActionEl) markAlreadyVoted(voteActionEl, me.alreadyVotedWardId);
}
