/**
 * Shows the comparison table's scroll hint only while the table actually
 * overflows its scroller (design-system §7.11). The hint is rendered `hidden`
 * so a visitor without JavaScript never sees a hint for scrolling that is not
 * needed; the scroller stays keyboard-focusable either way.
 */
export function initCompareScrollHint(): void {
  const hint = document.querySelector<HTMLElement>('[data-compare-scroll-hint]');
  const scroller = document.querySelector<HTMLElement>('[data-compare-scroll]');
  if (!hint || !scroller) return;

  const sync = (): void => {
    hint.hidden = scroller.scrollWidth <= scroller.clientWidth;
  };
  sync();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(sync).observe(scroller);
  else window.addEventListener('resize', sync);
}
