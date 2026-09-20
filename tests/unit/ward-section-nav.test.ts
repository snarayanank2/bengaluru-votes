// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { initWardSectionNav } from '../../src/islands/WardSectionNav';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps the section at the sticky header active even when the next section is more visible', () => {
  document.body.innerHTML = `
    <nav data-ward-section-nav>
      <a href="#issues" data-ward-section-tab="issues">What matters</a>
      <a href="#questions" data-ward-section-tab="questions">Candidate questions</a>
    </nav>
    <section id="issues"></section><section id="questions"></section>`;
  const nav = document.querySelector('nav')!;
  const issues = document.getElementById('issues')!;
  const questions = document.getElementById('questions')!;
  vi.spyOn(nav, 'getBoundingClientRect').mockReturnValue({ bottom: 141 } as DOMRect);
  vi.spyOn(issues, 'getBoundingClientRect').mockReturnValue({ top: 144 } as DOMRect);
  const questionRect = vi.spyOn(questions, 'getBoundingClientRect').mockReturnValue({ top: 445 } as DOMRect);
  let nextFrame: FrameRequestCallback | undefined;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { nextFrame = callback; return 1; });
  initWardSectionNav();
  expect(document.querySelector('[aria-current]')?.textContent).toBe('What matters');

  questionRect.mockReturnValue({ top: 144 } as DOMRect);
  window.dispatchEvent(new Event('scroll'));
  nextFrame?.(0);
  expect(document.querySelector('[aria-current]')?.textContent).toBe('Candidate questions');

  questionRect.mockReturnValue({ top: 445 } as DOMRect);
  window.dispatchEvent(new Event('scroll'));
  nextFrame?.(0);
  expect(document.querySelector('[aria-current]')?.textContent).toBe('What matters');

  vi.stubGlobal('scrollY', 1000);
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(1000 + window.innerHeight);
  window.dispatchEvent(new Event('scroll'));
  nextFrame?.(0);
  expect(document.querySelector('[aria-current]')?.textContent).toBe('Candidate questions');
});
