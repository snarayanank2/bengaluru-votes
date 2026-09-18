export function initWardSectionNav(): void {
  const nav = document.querySelector<HTMLElement>('[data-ward-section-nav]');
  if (!nav) return;

  const tabs = Array.from(nav.querySelectorAll<HTMLAnchorElement>('[data-ward-section-tab]'));
  const sections = tabs
    .map((tab) => document.getElementById(tab.dataset.wardSectionTab ?? ''))
    .filter((section): section is HTMLElement => section !== null);
  if (tabs.length === 0 || sections.length === 0) return;

  const setActive = (sectionId: string): void => {
    for (const tab of tabs) {
      if (tab.dataset.wardSectionTab === sectionId) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
  };

  for (const tab of tabs) {
    tab.addEventListener('click', () => setActive(tab.dataset.wardSectionTab ?? ''));
  }

  if (!('IntersectionObserver' in window)) return;

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActive(visible.target.id);
    },
    { rootMargin: '-92px 0px -55% 0px', threshold: [0, 0.25, 0.5, 1] },
  );

  for (const section of sections) observer.observe(section);
}
