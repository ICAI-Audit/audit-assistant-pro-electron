// Password fields that leave nothing behind when they go (rule: a password is never left in memory after a
// dialog closes; REV-B B2). Shared by Protect with password (a new password, typed twice) and the password
// prompt for a protected file (the source file's real password).
//
// Clearing the state alone is not enough, as heap snapshots showed in lane W2-PR's drive: React DOM keeps the
// last focused text field and its fiber (its select-event tracking) until the next focusout, and a field
// removed while focused (Enter, Escape, a change of engagement) never gets one; the detached field held the
// password in its value and its value attribute. React also keeps the previous props of a field (its
// alternate fiber) until the next render of it. So the fields are wiped as they leave, and on every clear
// they are wiped and rebuilt under a new key: React drops a removed field's props, and the new field has
// never held the password.
import { useCallback, useLayoutEffect, useState } from 'react';

/** The parts of an input element a wipe touches (a stand-in in tests). */
export interface WipeableField {
  value: string;
  removeAttribute(name: string): void;
}

/** Empties each field: its value and its value attribute. */
export function wipeFields(nodes: Iterable<WipeableField>): void {
  for (const node of nodes) {
    node.value = '';
    node.removeAttribute('value');
  }
}

/**
 * A callback ref for a password field: records the node in `nodes` (to be wiped) and, when given, in `also`.
 * Made at module level on purpose: a closure made inside a dialog would hold the dialog's scope, its state
 * included, and React leaves a removed field's `ref` on its fiber.
 */
export function fieldRef<T extends WipeableField>(nodes: Set<T>, also?: { current: T | null }): (node: T | null) => void {
  return (node) => {
    if (also) also.current = node;
    if (node) nodes.add(node);
  };
}

/**
 * The password fields of one dialog: `nodes` holds every field node made (give each field a ref from
 * `fieldRef(nodes)`), wiped when the dialog goes; `clear` wipes them now and bumps `generation`, which the
 * dialog puts in each field's key so that the fields are made afresh.
 */
export function useSecretFields(): { nodes: Set<HTMLInputElement>; generation: number; clear: () => void } {
  const [nodes] = useState(() => new Set<HTMLInputElement>());
  useLayoutEffect(() => () => wipeFields(nodes), [nodes]);
  const [generation, setGeneration] = useState(0);
  const clear = useCallback(() => {
    wipeFields(nodes);
    nodes.clear();
    setGeneration((g) => g + 1);
  }, [nodes]);
  return { nodes, generation, clear };
}
