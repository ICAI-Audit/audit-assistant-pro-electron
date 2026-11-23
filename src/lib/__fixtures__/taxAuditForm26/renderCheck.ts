// Checks shared by the static-render tests of the Form No. 26 components (no DOM: react-dom/server).
import { expect } from 'vitest';

/** The text a reader sees: tags removed, the entities React writes decoded. */
export function visibleText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The value of one attribute everywhere it appears. */
export function attributeValues(html: string, name: string): string[] {
  const values: string[] = [];
  const pattern = new RegExp(`\\s${name}="([^"]*)"`, 'g');
  for (let match = pattern.exec(html); match !== null; match = pattern.exec(html)) values.push(match[1]);
  return values;
}

/** Every id that a label, a description or a control refers to is on the page, and every id is used once. */
export function expectReferencesResolve(html: string): void {
  const ids = attributeValues(html, 'id');
  expect(new Set(ids).size, 'ids are unique').toBe(ids.length);
  const known = new Set(ids);
  for (const name of ['aria-labelledby', 'aria-describedby', 'aria-controls', 'for']) {
    for (const value of attributeValues(html, name)) {
      for (const id of value.split(/\s+/).filter(Boolean)) expect(known.has(id), `${name}="${value}" refers to a missing id ${id}`).toBe(true);
    }
  }
}

// Words that mark content as doubtful or unfinished (ruling R7). Each is written with one letter in brackets
// so that a search of the source for these words finds real uses only, not this list.
const UNFINISHED = /our rea[d]ing|to be veri[f]ied|\bs[i]c\b|m[o]ck|T[O]DO|l[o]rem|dra[f]t of|edi[t]or's note/i;

/** Nothing on screen marks the tool's own content as doubtful or unfinished, and nothing is cut. */
export function expectFinished(html: string): void {
  expect(html).not.toMatch(UNFINISHED);
  expect(html).not.toMatch(/\btruncate\b|line-clamp|text-ellipsis|overflow-x-(auto|scroll)/);
  expect(visibleText(html)).not.toContain('…');
}

/**
 * Every control that takes an answer has a name: a label element, aria-labelledby or aria-label. (Radix
 * draws a hidden native radio beside each option for forms; it is aria-hidden and not a control here.)
 */
export function expectControlsNamed(html: string): void {
  const controls = (html.match(/<(input|select|textarea)\b[^>]*>/g) ?? []).filter((control) => !control.includes('aria-hidden="true"'));
  const labelled = new Set(attributeValues(html, 'for'));
  for (const control of controls) {
    const id = /\sid="([^"]*)"/.exec(control)?.[1];
    const named = /\saria-label(ledby)?="[^"]+"/.test(control) || (id !== undefined && labelled.has(id));
    expect(named, `control without a name: ${control.slice(0, 120)}`).toBe(true);
  }
}
