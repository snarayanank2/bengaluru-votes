// @vitest-environment jsdom
/**
 * The transcriber's hold countdown (src/islands/TranscribeForm.ts), driven by
 * fake timers: a visible warning from five minutes, a polite announcement at
 * five and again at one minute, and the return to Start with the expiry
 * notice when time runs out (design-system §7.13, "Hold timer").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startCountdown } from '../../src/islands/TranscribeForm';

const START = Date.parse('2026-11-06T10:00:00Z');

function mount(minutes: number) {
  document.body.innerHTML = `
    <dd role="timer" data-expires-at="${new Date(START + minutes * 60000).toISOString()}" data-minutes-template="{minutes} min"></dd>
    <p data-timer-warning data-warning-template="Ends in {minutes}. Save." hidden></p>
    <div role="status" data-timer-announce></div>`;
  return {
    time: document.querySelector<HTMLElement>('[data-expires-at]')!,
    warning: document.querySelector<HTMLElement>('[data-timer-warning]')!,
    live: document.querySelector<HTMLElement>('[data-timer-announce]')!,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});
afterEach(() => vi.useRealTimers());

describe('hold timer', () => {
  it('shows no warning with ten minutes left, then warns and announces at five', () => {
    const { time, warning, live } = mount(10);
    const redirect = vi.fn();
    startCountdown({ redirect });
    expect(time.textContent).toBe('10 min');
    expect(warning.hidden).toBe(true);
    expect(live.textContent).toBe('');
    expect(time.hasAttribute('data-ending')).toBe(false);

    vi.advanceTimersByTime(5 * 60000);
    expect(time.textContent).toBe('5 min');
    expect(time.hasAttribute('data-ending')).toBe(true);
    expect(warning.hidden).toBe(false);
    expect(warning.textContent).toBe('Ends in 5 min. Save.');
    expect(live.textContent).toBe('Ends in 5 min. Save.');
    expect(redirect).not.toHaveBeenCalled();
  });

  it('announces again at one minute, and only then', () => {
    const { live } = mount(10);
    startCountdown({ redirect: vi.fn() });
    vi.advanceTimersByTime(5 * 60000);
    live.textContent = '';
    vi.advanceTimersByTime(3 * 60000);
    expect(live.textContent).toBe('');
    vi.advanceTimersByTime(60000);
    expect(live.textContent).toBe('Ends in 1 min. Save.');
  });

  it('returns to Start with the expiry notice when the hold runs out', () => {
    mount(2);
    const redirect = vi.fn();
    startCountdown({ redirect });
    vi.advanceTimersByTime(2 * 60000 - 1000);
    expect(redirect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(redirect).toHaveBeenCalledWith('/transcribe?expired=1');
  });

  it('warns at once, and announces once, when the page opens with under five minutes left', () => {
    const { warning, live } = mount(3);
    startCountdown({ redirect: vi.fn() });
    expect(warning.hidden).toBe(false);
    expect(live.textContent).toBe('Ends in 3 min. Save.');
  });
});
