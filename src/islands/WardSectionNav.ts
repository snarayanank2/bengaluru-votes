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

  // Follow the section at the reading edge. Comparing visible areas can
  // highlight the next section while a short current section is still on top.
  const syncActive = (): void => {
    const readingEdge = nav.getBoundingClientRect().bottom + 4;
    let active = sections[0];
    for (const section of sections) {
      if (section.getBoundingClientRect().top > readingEdge) break;
      active = section;
    }
    // A short final section may reach the page bottom before its top can
    // reach the header's reading edge.
    if (window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1) {
      active = sections[sections.length - 1];
    }
    setActive(active.id);
  };

  let framePending = false;
  const scheduleSync = (): void => {
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(() => {
      framePending = false;
      syncActive();
    });
  };
  window.addEventListener('scroll', scheduleSync, { passive: true });
  window.addEventListener('resize', scheduleSync);
  syncActive();
}
