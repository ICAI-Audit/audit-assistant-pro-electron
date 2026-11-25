// Redact's choices (design 5.9): what to look for (profile, kinds of data, the user's own words) and
// what the result is (Remove or Replace, searchable or picture only, and the resolution under "More
// options", whose closed line says the current value). UX audit section E: at most five decisions in
// view, "Recommended" in sentence case, every reason in plain words.
//
// Confidentiality: a typed word is shown in its chip (the user typed it); the remove button's name is
// "Remove word 2", never the word; no value or word is put into an attribute. The fields that take a
// typed word, its reason and a custom token leave nothing behind (dialogs/ProtectDialog.tsx does the
// same for passwords): React DOM keeps the last focused text field and its fiber after the field is
// removed, so each field is wiped as it leaves (the dialog closes, the engagement changes, a run ends
// and the dialog goes); and React's previous copy of a field (its alternate fiber) keeps the props it
// had, so a field that is cleared (a word added, a run ended) is wiped and rebuilt under a new key.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { termError, TERM_LIMITS, TERM_RULE, type RedactGroup } from '@/lib/pdf-tools/redactPatterns';
import { cn } from '@/lib/utils';
import { formatBytes } from '../format';
import type { RedactChoices } from './redactChoices';
import { DPI_CHOICES, tokenError, type RedactDpi } from './redactRecord';
import { GROUP_NAMES, GROUP_ORDER, notFoundLine, PROFILE_LABELS, SEPARATE_GROUP } from './redactView';
import type { ReviewAction, ReviewProfile, ReviewState } from './reviewState';

function Radio<T extends string>({ value, onChange, options, label, testPrefix, disabled }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; hint?: string; badge?: string }[]; label: string; testPrefix: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <p id={`${id}-label`} className="text-xs font-medium text-foreground">
        {label}
      </p>
      <RadioGroup aria-labelledby={`${id}-label`} value={value} onValueChange={(v) => onChange(v as T)} className="grid gap-1.5" disabled={disabled}>
        {options.map((o) => (
          <Label key={o.value} htmlFor={`${id}-${o.value}`} className={cn('flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-1.5 font-normal', o.value === value ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40')}>
            <RadioGroupItem id={`${id}-${o.value}`} value={o.value} className="mt-0.5" data-testid={`${testPrefix}-${o.value}`} />
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-foreground">
                {o.label}
                {o.badge && <span className="rounded-full bg-primary/10 px-1.5 text-[11px] font-medium leading-4 text-primary">{o.badge}</span>}
              </span>
              {o.hint && <span className="block text-[11px] leading-snug text-muted-foreground">{o.hint}</span>}
            </span>
          </Label>
        ))}
      </RadioGroup>
    </div>
  );
}

/**
 * A callback ref for a field that takes a typed word or a token: records the node in `nodes`, to be
 * wiped. Made at module level on purpose: a closure made inside a component would hold its scope, its
 * state included, and React leaves a removed field's `ref` on its fiber.
 */
function fieldRef(nodes: Set<HTMLInputElement>, also?: { current: HTMLInputElement | null }) {
  return (node: HTMLInputElement | null) => {
    if (also) also.current = node;
    if (node) nodes.add(node);
  };
}

function wipe(nodes: Set<HTMLInputElement>): void {
  for (const node of nodes) {
    node.value = '';
    node.removeAttribute('value');
  }
  nodes.clear();
}

/**
 * The secret fields of one component: refs for them, their key generation, a wipe when the component
 * goes, and `clear()` (wipe the nodes and rebuild the fields under a new key). `runs` changes when a run
 * ends: the fields are cleared then too.
 */
function useSecretFields(runs: number, onRunEnd: () => void, firstNode?: { current: HTMLInputElement | null }) {
  const [refs] = useState(() => {
    const nodes = new Set<HTMLInputElement>();
    return { nodes, first: fieldRef(nodes, firstNode), second: fieldRef(nodes) };
  });
  const [generation, setGeneration] = useState(0);
  useLayoutEffect(() => () => wipe(refs.nodes), [refs]);
  const clear = () => {
    wipe(refs.nodes);
    setGeneration((g) => g + 1);
  };
  const endRef = useRef(onRunEnd);
  endRef.current = onRunEnd;
  const seen = useRef(runs);
  useEffect(() => {
    if (seen.current === runs) return;
    seen.current = runs;
    wipe(refs.nodes);
    setGeneration((g) => g + 1);
    endRef.current();
  }, [runs, refs]);
  return { refs, generation, clear };
}

/**
 * What to look for: the profile, the kinds of data, and the user's own words. `runs` changes each time a run ends.
 * `notFound`: the indexes of the typed words the find placed nowhere (ruling R): their chips are marked, and one line counts them.
 */
export function FindControls({
  state,
  dispatch,
  onProfile,
  disabled,
  runs = 0,
  notFound = [],
}: {
  state: ReviewState;
  dispatch: (a: ReviewAction) => void;
  onProfile: (p: ReviewProfile) => void;
  disabled: boolean;
  runs?: number;
  notFound?: readonly number[];
}) {
  const id = useId();
  const [term, setTerm] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const termNode = useRef<HTMLInputElement | null>(null);
  // A word typed and not added is dropped when a run ends, like the fields' own copies.
  const secret = useSecretFields(
    runs,
    () => {
      setTerm('');
      setReason('');
      setError(null);
    },
    termNode,
  );
  const add = () => {
    const problem = termError(term) ?? (state.terms.length >= TERM_LIMITS.count ? `Up to ${TERM_LIMITS.count} words can be added.` : null);
    setError(problem);
    if (problem) return;
    dispatch({ type: 'add-term', term: { text: term, reason } });
    setTerm('');
    setReason('');
    // The added word now lives in the review (its chip); the fields keep no copy of it. Focus goes back
    // to the new word field for the next word.
    secret.clear();
    focusTerm.current = true;
  };
  const focusTerm = useRef(false);
  useEffect(() => {
    if (!focusTerm.current) return;
    focusTerm.current = false;
    termNode.current?.focus();
  }, [secret.generation]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Label htmlFor={`${id}-profile`} className="shrink-0 text-xs">
          Find
        </Label>
        <select
          id={`${id}-profile`}
          data-testid="pdf-tools-redact-profile"
          value={state.profile}
          disabled={disabled}
          onChange={(event) => onProfile(event.target.value as ReviewProfile)}
          aria-describedby={`${id}-profile-hint`}
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {(Object.keys(PROFILE_LABELS) as ReviewProfile[]).map((p) => (
            <option key={p} value={p}>
              {PROFILE_LABELS[p].label}
              {p === 'balanced' ? ' (Recommended)' : ''}
            </option>
          ))}
        </select>
      </div>
      <p id={`${id}-profile-hint`} className="text-[11px] leading-snug text-muted-foreground">
        {PROFILE_LABELS[state.profile].description}
      </p>
      <fieldset className="space-y-1.5" disabled={disabled}>
        <legend className="sr-only">Kinds of data ticked</legend>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {GROUP_ORDER.filter((group) => group !== SEPARATE_GROUP).map((group: RedactGroup) => (
            <label key={group} className="flex min-w-0 cursor-pointer items-start gap-1.5 text-xs leading-snug text-foreground">
              <Checkbox className="mt-px" data-testid={`pdf-tools-redact-group-${group}`} checked={state.groups.has(group)} onCheckedChange={(on) => dispatch({ type: 'tick-group', group, on: on === true })} />
              {GROUP_NAMES[group]}
            </label>
          ))}
        </div>
        {/* Ticked by no profile: shown apart, so it is a choice the user makes. */}
        <label className="flex cursor-pointer items-start gap-1.5 border-t pt-1.5 text-xs leading-snug text-foreground">
          <Checkbox
            className="mt-px"
            data-testid={`pdf-tools-redact-group-${SEPARATE_GROUP}`}
            aria-describedby={`${id}-separate-hint`}
            checked={state.groups.has(SEPARATE_GROUP)}
            onCheckedChange={(on) => dispatch({ type: 'tick-group', group: SEPARATE_GROUP, on: on === true })}
          />
          <span className="min-w-0">
            {GROUP_NAMES[SEPARATE_GROUP]}
            <span id={`${id}-separate-hint`} className="block text-[11px] text-muted-foreground">
              No profile ticks these (CIN, DIN, LLPIN, UDIN, FRN, Udyam, IEC, LEI). Tick to redact them.
            </span>
          </span>
        </label>
      </fieldset>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-term`} className="text-xs">
          Your own words to redact
        </Label>
        <div className="flex gap-1.5">
          <Input
            key={`term-${secret.generation}`}
            ref={secret.refs.first}
            id={`${id}-term`}
            data-testid="pdf-tools-redact-term-input"
            value={term}
            disabled={disabled}
            maxLength={TERM_LIMITS.max}
            autoComplete="off"
            spellCheck={false}
            placeholder="A name, a number, a phrase"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-term-error ${id}-term-rule` : `${id}-term-rule`}
            onChange={(event) => {
              setTerm(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
            className="h-8 text-xs"
          />
          <Input
            key={`reason-${secret.generation}`}
            ref={secret.refs.second}
            aria-label="Reason (optional)"
            data-testid="pdf-tools-redact-term-reason"
            value={reason}
            disabled={disabled}
            maxLength={40}
            autoComplete="off"
            placeholder="Reason"
            onChange={(event) => setReason(event.target.value)}
            className="h-8 w-24 text-xs"
          />
          <Button type="button" size="sm" variant="outline" className="h-8 px-2" data-testid="pdf-tools-redact-term-add" disabled={disabled} onClick={add}>
            <Plus />
            Add
          </Button>
        </div>
        {error && (
          <p id={`${id}-term-error`} role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <p id={`${id}-term-rule`} className="text-[11px] leading-snug text-muted-foreground" data-testid="pdf-tools-redact-term-rule">
          {TERM_RULE}
        </p>
        {state.terms.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Your words">
            {state.terms.map((t, i) => (
              <li
                key={i}
                data-testid={notFound.includes(i) ? `pdf-tools-redact-term-not-found-${i}` : undefined}
                className={cn('flex items-center gap-1 rounded-full border py-0.5 pl-2 pr-0.5 text-xs text-foreground', notFound.includes(i) ? 'border-dashed border-warning bg-warning/10' : 'bg-muted/40')}
              >
                <span className="max-w-[180px] truncate">{t.text}</span>
                <span className="text-muted-foreground">· {notFound.includes(i) ? 'not found' : t.reason}</span>
                <button
                  type="button"
                  disabled={disabled}
                  data-testid={`pdf-tools-redact-term-remove-${i}`}
                  aria-label={`Remove word ${i + 1}`}
                  onClick={() => dispatch({ type: 'remove-term', text: t.text })}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {notFound.length > 0 && (
          <p className="text-xs text-foreground" role="status" data-testid="pdf-tools-redact-not-found">
            {notFoundLine(notFound.length)}
          </p>
        )}
      </div>
    </div>
  );
}

const DPI_NOTES: Record<RedactDpi, string> = {
  150: 'Smaller file, softer when zoomed.',
  200: 'About 100-300 KB a page of text, more for dense or coloured pages.',
  300: 'Sharpest, about twice the size.',
};

/**
 * The custom token's field. The token is never a prop passed through the page's elements: React keeps
 * a page element's props (its `__reactProps`) until one of its attributes changes, so a token passed down
 * would stay reachable after it was cleared (seen in the drive's heap snapshot after a failed run). The
 * dialog holds it in a stable `holder`; this field is uncontrolled, reads the holder once when it is
 * made, writes it as the user types, is wiped when it goes, and is made again under a new key when a run
 * ends (OutputControls), when the holder is back to the default.
 */
function TokenField({ id, holder, onToken, disabled, problem }: { id: string; holder: { current: string }; onToken: (token: string) => void; disabled: boolean; problem: string | null }) {
  const secret = useSecretFields(0, () => undefined);
  const [initial] = useState(() => holder.current);
  return (
    <div className="space-y-1">
      <Label htmlFor={`${id}-token`} className="text-xs">
        Token
      </Label>
      <Input
        ref={secret.refs.first}
        id={`${id}-token`}
        data-testid="pdf-tools-redact-token"
        defaultValue={initial}
        disabled={disabled}
        maxLength={40}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${id}-token-error` : undefined}
        onChange={(event) => onToken(event.target.value)}
        className="h-8 text-xs"
      />
      {problem && (
        <p id={`${id}-token-error`} role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}

/**
 * What the result is: Remove or Replace (and with what), searchable or picture only, and the resolution
 * under More options. The custom token is in `token` (a stable holder, never the text itself: see
 * TokenField); `runs` changes each time a run ends.
 */
export function OutputControls({
  choices,
  onChange,
  token,
  onToken,
  disabled,
  estimate,
  runs = 0,
}: {
  choices: RedactChoices;
  onChange: (c: RedactChoices) => void;
  token: { current: string };
  onToken: (token: string) => void;
  disabled: boolean;
  estimate: number;
  runs?: number;
}) {
  const id = useId();
  const [more, setMore] = useState(false);
  const tokenProblem = choices.mode === 'replace' && choices.style === 'token' ? tokenError(token.current) : null;
  const set = (patch: Partial<RedactChoices>) => onChange({ ...choices, ...patch });
  return (
    <div className="space-y-3">
      <Radio
        label="Each area"
        value={choices.mode}
        onChange={(mode) => set({ mode })}
        disabled={disabled}
        testPrefix="pdf-tools-redact-mode"
        options={[
          { value: 'remove', label: 'Remove', hint: 'A black box.', badge: 'Recommended' },
          { value: 'replace', label: 'Replace', hint: 'A black box with a replacement in white.' },
        ]}
      />
      {choices.mode === 'replace' && (
        <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
          <Radio
            label="Replacement"
            value={choices.style}
            onChange={(style) => set({ style })}
            disabled={disabled}
            testPrefix="pdf-tools-redact-replacement"
            options={[
              { value: 'token', label: 'Token', hint: 'The same words in every box.' },
              { value: 'label', label: 'Label by kind', hint: '[PAN redacted], [email redacted] ...' },
              { value: 'masked', label: 'Masked value', hint: 'Masked values show the last four characters. Use Token or Label if even those must not appear.' },
            ]}
          />
          {choices.style === 'token' && <TokenField key={`token-${runs}`} id={id} holder={token} onToken={onToken} disabled={disabled} problem={tokenProblem} />}
        </div>
      )}
      <Radio
        label="Redacted pages"
        value={choices.output}
        onChange={(output) => set({ output })}
        disabled={disabled}
        testPrefix="pdf-tools-redact-output"
        options={[
          { value: 'searchable', label: 'Searchable', hint: 'A picture of the page; the words left can still be searched and copied.', badge: 'Recommended' },
          { value: 'picture', label: 'Picture only', hint: 'A picture of the page, with no searchable text.' },
        ]}
      />
      <Collapsible open={more} onOpenChange={setMore}>
        <CollapsibleTrigger
          data-testid="pdf-tools-redact-more"
          disabled={disabled}
          className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1 text-left text-xs text-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span>
            <span className="font-medium">More options</span>
            <span className="text-muted-foreground"> · {choices.dpi} dpi, about {formatBytes(estimate)}</span>
          </span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', more && 'rotate-180')} aria-hidden="true" />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <Radio
            label="Resolution of the redacted pages"
            value={String(choices.dpi) as `${RedactDpi}`}
            onChange={(dpi) => set({ dpi: Number(dpi) as RedactDpi })}
            disabled={disabled}
            testPrefix="pdf-tools-redact-dpi"
            options={DPI_CHOICES.map((dpi) => ({ value: String(dpi) as `${RedactDpi}`, label: `${dpi} dpi`, hint: DPI_NOTES[dpi], ...(dpi === 200 ? { badge: 'Recommended' } : {}) }))}
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
