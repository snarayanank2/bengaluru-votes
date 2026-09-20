/**
 * ModalShell — shared <dialog> modal behavior (design-system.md §7.9).
 * Framework-free vanilla TS over the native <dialog> element. The three
 * real modals (Register/Login, Flag misinformation, Cast issue vote — IA
 * §7, Tasks 27/32/33) each import `ModalController` (or `initModal`),
 * wrap their own `<dialog>` markup/content, and get this shared shell
 * behavior for free:
 *
 *   - open()/close() lifecycle over dialog.showModal()/close()
 *   - Escape closes the dialog (handled explicitly here so it composes
 *     with the same cleanup path as every other close route, rather than
 *     relying only on the browser's native Escape -> 'cancel' -> 'close'
 *     sequence)
 *   - scrim-tap closes: a click whose target is the <dialog> element
 *     itself (not a descendant) is a backdrop click — the standard way to
 *     detect it without a separate overlay element
 *   - an explicit close button: any element inside the dialog marked
 *     `data-modal-close` closes it on click
 *   - focus trap: Tab/Shift+Tab cycle within the dialog's focusable
 *     elements while it's open
 *   - focus returns to the opening element (passed explicitly to open(),
 *     or the currently-focused element if omitted) once the dialog closes
 *   - the URL never changes — this module makes no navigation/history call
 *
 * Bottom-sheet layout (rounded top corners, full-width below md) is pure CSS
 * owned by each modal's own component, not this behavior module.
 *
 * Testability: the class only touches a small structural slice of
 * HTMLDialogElement (open/showModal/close/querySelectorAll/EventTarget),
 * so tests/unit/components.test.ts exercises it against a minimal fake
 * dialog built on Node's built-in EventTarget — no jsdom dependency
 * needed for this module's logic.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** Every focusable element currently inside `container`, in DOM order. */
export function getFocusableElements(container: ParentNode): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * Pure decision function for the Tab-trap: given the pressed key, whether
 * Shift was held, the current focusable set, and the currently-active
 * element, returns the element focus should move to — or null if no trap
 * action is needed (not a Tab press, or focus isn't on a trap boundary).
 * Exported and pure so the wrap-around logic is unit-testable without a
 * real DOM.
 */
export function computeTabTrapTarget(
  key: string,
  shiftKey: boolean,
  focusables: HTMLElement[],
  active: unknown,
): HTMLElement | null {
  if (key !== 'Tab' || focusables.length === 0) return null;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (shiftKey && active === first) return last;
  if (!shiftKey && active === last) return first;
  return null;
}

/**
 * The minimal shape ModalController needs. A real `HTMLDialogElement`
 * satisfies this; tests supply a small fake built on Node's `EventTarget`.
 */
export interface ModalDialogLike extends EventTarget {
  open: boolean;
  showModal(): void;
  close(): void;
  querySelectorAll<E extends Element = Element>(selectors: string): NodeListOf<E> | ArrayLike<E>;
}

export interface FocusTarget {
  focus(): void;
}

export class ModalController {
  private dialog: ModalDialogLike;
  private opener: FocusTarget | null = null;
  private readonly boundKeydown = (e: Event) => this.handleKeydown(e as KeyboardEvent);
  private readonly boundClick = (e: Event) => this.handleClick(e as MouseEvent);
  private readonly boundClose = () => this.handleClose();

  constructor(dialog: ModalDialogLike) {
    this.dialog = dialog;
  }

  /** Opens the dialog. `opener` is who focus returns to on close; defaults to the current document.activeElement. */
  open(opener?: FocusTarget | null): void {
    this.opener =
      opener ?? (typeof document !== 'undefined' ? (document.activeElement as unknown as FocusTarget) : null);

    this.dialog.addEventListener('keydown', this.boundKeydown);
    this.dialog.addEventListener('click', this.boundClick);
    this.dialog.addEventListener('close', this.boundClose);

    this.dialog.showModal();
    this.focusFirst();
  }

  /** Closes the dialog if open. Fires the dialog's native 'close' event, which runs cleanup + focus return. */
  close(): void {
    if (this.dialog.open) {
      this.dialog.close();
    }
  }

  private focusFirst(): void {
    const focusables = getFocusableElements(this.dialog as unknown as ParentNode);
    focusables[0]?.focus();
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault?.();
      this.close();
      return;
    }

    if (e.key === 'Tab') {
      const focusables = getFocusableElements(this.dialog as unknown as ParentNode);
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      const target = computeTabTrapTarget(e.key, e.shiftKey, focusables, active);
      if (target) {
        e.preventDefault?.();
        target.focus();
      }
    }
  }

  private handleClick(e: MouseEvent): void {
    const target = e.target as (Element & { closest?: (s: string) => Element | null }) | null;

    // Scrim tap: click landed on the <dialog> element itself, not a descendant.
    if (e.target === (this.dialog as unknown as EventTarget)) {
      this.close();
      return;
    }

    if (target?.closest?.('[data-modal-close]')) {
      this.close();
    }
  }

  private handleClose(): void {
    this.dialog.removeEventListener('keydown', this.boundKeydown);
    this.dialog.removeEventListener('click', this.boundClick);
    this.dialog.removeEventListener('close', this.boundClose);
    this.opener?.focus();
  }
}

/** Functional-style alternative to `new ModalController(dialogEl)`. */
export function initModal(dialogEl: ModalDialogLike): {
  open: (opener?: FocusTarget | null) => void;
  close: () => void;
} {
  const controller = new ModalController(dialogEl);
  return {
    open: (opener) => controller.open(opener),
    close: () => controller.close(),
  };
}
