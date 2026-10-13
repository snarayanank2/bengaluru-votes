/** One field's form strings to a structured value and back (src/lib/affidavit-form.ts). No database. */
import { describe, it, expect } from 'vitest';
import { errorFor, fieldFromInputs, inputsOf, readFieldForm, storedFieldData, FIELD_INPUTS } from '../../src/lib/affidavit-form';

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe('readFieldForm', () => {
  it('reads only the named field, defaulting the status to value', () => {
    const raw = readFieldForm(form({ movableInr: '10', immovableInr: '20', age: '44' }), 'assets');
    expect(raw).toEqual({ status: 'value', inputs: { movableInr: '10', immovableInr: '20' } });
  });

  it('reads the posted status and treats an unknown one as value', () => {
    expect(readFieldForm(form({ 'status.age': 'not_declared' }), 'age').status).toBe('not_declared');
    expect(readFieldForm(form({ 'status.age': 'nonsense' }), 'age').status).toBe('value');
  });

  it('gives an empty string for an input that was not posted (a disabled input is not submitted)', () => {
    expect(readFieldForm(form({ 'status.cases': 'unreadable' }), 'cases').inputs).toEqual({ pending: '', convictions: '' });
  });
});

describe('fieldFromInputs and errorFor', () => {
  it('accepts Indian digit grouping and spaces in rupee amounts', () => {
    const data = fieldFromInputs('assets', 'value', { movableInr: '1,02,10,000', immovableInr: '3 50 00 000' });
    expect(data).toEqual({ key: 'assets', status: 'value', movableInr: 10210000, immovableInr: 35000000 });
    expect(errorFor(data, { movableInr: '1,02,10,000', immovableInr: '3 50 00 000' })).toBeNull();
  });

  it.each([
    ['full_name', { name: '  ' }, 'required'],
    ['party', { party: '' }, 'required'],
    ['gender', { gender: 'robot' }, 'choose'],
    ['education', { educationLevel: '', educationStated: 'B.Com' }, 'choose'],
    ['age', { age: '' }, 'required'],
    ['age', { age: 'forty' }, 'whole_number'],
    ['age', { age: '121' }, 'age_range'],
    ['assets', { movableInr: '12.5', immovableInr: '0' }, 'whole_number'],
    ['cases', { pending: '', convictions: '' }, 'required'],
  ] as const)('refuses %s %j as %s', (key, inputs, error) => {
    expect(errorFor(fieldFromInputs(key, 'value', inputs), inputs)).toBe(error);
  });

  it('ignores the inputs when the status is not value', () => {
    const data = fieldFromInputs('age', 'not_declared', { age: 'forty' });
    expect(data).toEqual({ key: 'age', status: 'not_declared', years: null });
    expect(errorFor(data, { age: 'forty' })).toBeNull();
  });
});

describe('inputsOf', () => {
  it('round-trips every field through the form', () => {
    const samples = [
      { key: 'full_name', status: 'value', text: 'A. Person' },
      { key: 'party', status: 'value', text: 'Independent' },
      { key: 'gender', status: 'value', gender: 'female' },
      { key: 'age', status: 'value', years: 52 },
      { key: 'education', status: 'value', level: 'Graduate', stated: 'B.Com' },
      { key: 'assets', status: 'value', movableInr: 1, immovableInr: 2 },
      { key: 'cases', status: 'value', pending: 2, convictions: 0 },
    ] as const;
    for (const sample of samples) {
      const inputs = inputsOf(sample);
      expect(Object.keys(inputs).sort()).toEqual([...FIELD_INPUTS[sample.key]].sort());
      expect(fieldFromInputs(sample.key, 'value', inputs)).toEqual(sample);
    }
  });
});

describe('storedFieldData', () => {
  it('returns the stored value only when it is for this field', () => {
    const age = { key: 'age', status: 'value', years: 52 };
    expect(storedFieldData('age', age)).toEqual(age);
    expect(storedFieldData('cases', age)).toBeNull();
    expect(storedFieldData('age', null)).toBeNull();
  });
});
