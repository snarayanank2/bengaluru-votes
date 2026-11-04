import { describe, expect, it } from 'vitest';
import { chooseTag } from '../../../scripts/ci/tag';

const date = '2026.11.04';
const t = (name: string, commit = 'other') => ({ name, commit });

describe('chooseTag', () => {
  it('first of the day', () => {
    expect(chooseTag({ date, existing: [], commit: 'c1' })).toEqual({ name: 'v2026.11.04', create: true });
  });
  it('second of the day gets .2, third .3', () => {
    expect(chooseTag({ date, existing: [t('v2026.11.04')], commit: 'c1' }).name).toBe('v2026.11.04.2');
    expect(chooseTag({ date, existing: [t('v2026.11.04'), t('v2026.11.04.2')], commit: 'c1' }).name).toBe('v2026.11.04.3');
  });
  it('reuses the existing tag when it already points at this commit', () => {
    expect(chooseTag({ date, existing: [t('v2026.11.04'), t('v2026.11.04.2', 'c1')], commit: 'c1' })).toEqual({ name: 'v2026.11.04.2', create: false });
  });
  it('ignores tags from other days and non-date tags', () => {
    expect(chooseTag({ date, existing: [t('v2026.11.03'), t('v2026.11.03.5'), t('vfoo')], commit: 'c1' }).name).toBe('v2026.11.04');
  });
  it('handles a gap by going past the highest', () => {
    expect(chooseTag({ date, existing: [t('v2026.11.04'), t('v2026.11.04.3')], commit: 'c1' }).name).toBe('v2026.11.04.4');
  });
});
