/**
 * Shows a scroll hint only while its table actually overflows its scroller
 * (design-system §7.11). Each `[data-scroll-hint]` is rendered `hidden` and
 * is paired with the scroller that immediately follows it
 * (`[data-scroll-region]`), so a visitor without JavaScript never sees a hint
 * for scrolling that is not needed; the scroller stays keyboard-focusable
 * either way. Used by the comparison table and by `ScrollRegion.astro`.
 */
export function initScrollHint(): void {
  document.querySelectorAll<HTMLElement>('[data-scroll-hint]').forEach((hint) => {
    const scroller = hint.nextElementSibling;
    if (!(scroller instanceof HTMLElement) || !scroller.hasAttribute('data-scroll-region')) return;

    const sync = (): void => {
      hint.hidden = scroller.scrollWidth <= scroller.clientWidth;
    };
    sync();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(sync).observe(scroller);
    else window.addEventListener('resize', sync);
  });
}
