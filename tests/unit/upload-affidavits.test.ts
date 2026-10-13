import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../scripts/upload-affidavits';

describe('upload-affidavits parseArgs', () => {
  it('reads the directory and the admin email in either order', () => {
    expect(parseArgs(['./pdfs', '--as', 'Admin@Example.com'])).toEqual({ dir: './pdfs', email: 'admin@example.com' });
    expect(parseArgs(['--as', 'admin@example.com', './pdfs'])).toEqual({ dir: './pdfs', email: 'admin@example.com' });
  });

  it.each([
    ['no arguments', []],
    ['no admin email', ['./pdfs']],
    ['--as with no value', ['./pdfs', '--as']],
    ['--as followed by another flag', ['./pdfs', '--as', '--force']],
    ['two directories', ['./a', './b', '--as', 'admin@example.com']],
  ])('rejects %s', (_name, argv) => {
    expect(parseArgs(argv)).toBeNull();
  });
});
