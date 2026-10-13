import { describe, it, expect, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  extractAffidavit,
  extractionSchema,
  checkExtraction,
  type AffidavitExtraction,
  type MessagesClient,
} from '../../src/lib/affidavit-extraction';

const PDF = Buffer.from('%PDF-1.4 fake');

function good(): AffidavitExtraction {
  return {
    age: { status: 'value', years: 52 },
    education: { status: 'value', level: 'Graduate', stated: 'B.Com, Bangalore University, 1994' },
    assets: { status: 'value', totalInr: 123456789, note: 'Movable 23456789; immovable 100000000' },
    cases: { status: 'value', pending: 0, convictions: 0, note: 'Affidavit states nil' },
    confidence: 85,
  };
}

function message(text: string, stopReason: string = 'end_turn'): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [{ type: 'text', text, citations: null }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 70000, output_tokens: 900 },
  } as unknown as Anthropic.Message;
}

function fakeClient(result: Anthropic.Message | Error) {
  const create = vi.fn(async (_params: Anthropic.MessageCreateParamsNonStreaming) => {
    if (result instanceof Error) throw result;
    return result;
  });
  const client: MessagesClient = { messages: { create } };
  return { client, create };
}

describe('extractionSchema', () => {
  it('converts to a structured-output format without throwing', () => {
    const format = zodOutputFormat(extractionSchema);
    expect(format.type).toBe('json_schema');
  });
});

describe('checkExtraction', () => {
  it('accepts a consistent extraction', () => {
    expect(checkExtraction(good())).toBeNull();
  });

  it('rejects status value with a null value', () => {
    const e = good();
    e.age = { status: 'value', years: null };
    expect(checkExtraction(e)).toMatch(/age/);
  });

  it('rejects a value present when status is unreadable', () => {
    const e = good();
    e.assets = { status: 'unreadable', totalInr: 5, note: null };
    expect(checkExtraction(e)).toMatch(/assets/);
  });

  it('accepts not_declared with null values and a note', () => {
    const e = good();
    e.cases = { status: 'not_declared', pending: null, convictions: null, note: 'Section left blank' };
    expect(checkExtraction(e)).toBeNull();
  });

  it.each([
    ['confidence above 100', (e: AffidavitExtraction) => { e.confidence = 140; }],
    ['negative assets', (e: AffidavitExtraction) => { e.assets.totalInr = -1; }],
    ['age of zero', (e: AffidavitExtraction) => { e.age.years = 0; }],
    ['negative case count', (e: AffidavitExtraction) => { e.cases.pending = -2; }],
  ])('rejects %s', (_name, mutate) => {
    const e = good();
    mutate(e);
    expect(checkExtraction(e)).not.toBeNull();
  });
});

describe('extractAffidavit', () => {
  it('returns the extraction and usage on a valid response', async () => {
    const { client, create } = fakeClient(message(JSON.stringify(good())));
    const outcome = await extractAffidavit(PDF, 'claude-haiku-5-5', client);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.extraction).toEqual(good());
    expect(outcome.usage).toMatchObject({
      model: 'claude-haiku-5-5',
      inputTokens: 70000,
      outputTokens: 900,
      stopReason: 'end_turn',
    });
    expect(outcome.usage.elapsedMs).toBeGreaterThanOrEqual(0);

    const params = create.mock.calls[0][0];
    expect(params.model).toBe('claude-haiku-5-5');
    expect(params.max_tokens).toBe(16000);
    expect(params.output_config?.effort).toBe('medium');
    expect(params).not.toHaveProperty('tool_choice');
    expect(params).not.toHaveProperty('fallbacks');
    const content = params.messages[0].content as Anthropic.ContentBlockParam[];
    expect(content[0]).toMatchObject({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: PDF.toString('base64') },
    });
    expect(content[1].type).toBe('text');
  });

  it('reports a refusal', async () => {
    const { client } = fakeClient(message('', 'refusal'));
    const outcome = await extractAffidavit(PDF, 'claude-opus-5-5', client);
    expect(outcome).toMatchObject({ ok: false, failure: 'refusal' });
  });

  it('reports truncation and keeps usage', async () => {
    const { client } = fakeClient(message('{"age":', 'max_tokens'));
    const outcome = await extractAffidavit(PDF, 'claude-opus-5-5', client);
    expect(outcome).toMatchObject({ ok: false, failure: 'truncated', usage: { outputTokens: 900 } });
  });

  it('reports text that is not JSON as invalid_output', async () => {
    const { client } = fakeClient(message('I could not read this document.'));
    const outcome = await extractAffidavit(PDF, 'claude-sonnet-5-5', client);
    expect(outcome).toMatchObject({ ok: false, failure: 'invalid_output' });
  });

  it('reports a missing field as invalid_output', async () => {
    const { confidence: _dropped, ...partial } = good();
    const { client } = fakeClient(message(JSON.stringify(partial)));
    const outcome = await extractAffidavit(PDF, 'claude-sonnet-5-5', client);
    expect(outcome).toMatchObject({ ok: false, failure: 'invalid_output' });
  });

  it('reports an extra field as invalid_output', async () => {
    const { client } = fakeClient(message(JSON.stringify({ ...good(), party: 'XYZ' })));
    const outcome = await extractAffidavit(PDF, 'claude-sonnet-5-5', client);
    expect(outcome).toMatchObject({ ok: false, failure: 'invalid_output' });
  });

  it('reports a status/value mismatch as invalid_output', async () => {
    const e = good();
    e.cases = { status: 'value', pending: null, convictions: 0, note: null };
    const { client } = fakeClient(message(JSON.stringify(e)));
    const outcome = await extractAffidavit(PDF, 'claude-sonnet-5-5', client);
    expect(outcome).toMatchObject({ ok: false, failure: 'invalid_output' });
  });

  it('reports an API error without usage', async () => {
    const { client } = fakeClient(new Anthropic.APIConnectionError({ message: 'network down' }));
    const outcome = await extractAffidavit(PDF, 'claude-haiku-5-5', client);
    expect(outcome).toMatchObject({ ok: false, failure: 'api_error' });
    if (outcome.ok) return;
    expect(outcome.usage).toBeUndefined();
    expect(outcome.detail).toContain('network down');
  });

  it('throws on an empty buffer', async () => {
    const { client } = fakeClient(message(JSON.stringify(good())));
    await expect(extractAffidavit(Buffer.alloc(0), 'claude-haiku-5-5', client)).rejects.toThrow(/empty/);
  });

  it('rethrows errors that are not API errors', async () => {
    const { client } = fakeClient(new TypeError('bug'));
    await expect(extractAffidavit(PDF, 'claude-haiku-5-5', client)).rejects.toThrow('bug');
  });
});
