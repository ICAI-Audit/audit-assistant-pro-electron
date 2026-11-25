import { describe, expect, it } from 'vitest';
import { fieldRef, wipeFields, type WipeableField } from './secretFields';

/** A stand-in for an input element: its value and its attributes. */
function field(value: string) {
  const attributes = new Map<string, string>([['value', value]]);
  return {
    value,
    attributes,
    removeAttribute(name: string) {
      attributes.delete(name);
    },
  };
}

describe('password fields that leave nothing behind (REV-B B2)', () => {
  it('a wipe empties every field: its value and its value attribute', () => {
    const a = field('Synthetic-Pass-1');
    const b = field('Synthetic-Pass-1');
    wipeFields([a, b]);
    for (const f of [a, b]) {
      expect(f.value).toBe('');
      expect(f.attributes.has('value')).toBe(false);
    }
  });

  it('the ref records every node the field had (each rebuilt field adds its own) and keeps the latest in `also`', () => {
    const nodes = new Set<WipeableField>();
    const also: { current: WipeableField | null } = { current: null };
    const ref = fieldRef(nodes, also);
    const first = field('one');
    const second = field('two');
    ref(first);
    ref(null); // React calls the ref with null when the field goes
    expect(also.current).toBeNull();
    ref(second);
    expect([...nodes]).toEqual([first, second]);
    expect(also.current).toBe(second);
    wipeFields(nodes);
    expect([first.value, second.value]).toEqual(['', '']);
  });
});
