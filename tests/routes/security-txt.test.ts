import { describe, it, expect } from 'vitest';
import { GET } from '../../src/pages/.well-known/security.txt';

describe('security.txt', () => {
  it('has Contact and a future Expires', async () => {
    const res = await GET({} as any);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('Contact: mailto:');
    const expires = body.match(/^Expires: (.+)$/m)?.[1];
    expect(new Date(expires!).getTime()).toBeGreaterThan(Date.now());
  });
});
