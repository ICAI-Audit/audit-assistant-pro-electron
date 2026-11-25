// A small "go to page" number box, the same in the page viewer and in the Bookmarks dialog's page strip:
// type a number and press Enter to go there; a number that is not in the file says the range and keeps
// what was typed, selected, for another try; leaving the box goes to a valid number or puts the current
// page back. The caller renders the field with `inputProps` and the message (`problem`, with the id
// `problemId`) where it fits.
import { useEffect, useId, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { pageFromInput, pageJumpProblem } from './viewerMath';

export interface PageJump {
  inputProps: {
    value: string;
    inputMode: 'numeric';
    autoComplete: 'off';
    spellCheck: false;
    'aria-invalid': true | undefined;
    'aria-describedby': string | undefined;
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
    onBlur: () => void;
  };
  /** Why the number typed cannot be shown (role="alert" where it is rendered), or null. */
  problem: string | null;
  problemId: string;
}

const digitsOnly = (text: string) => {
  let out = '';
  for (const ch of text) if (ch >= '0' && ch <= '9') out += ch;
  return out.slice(0, 6);
};

export function usePageJump(page: number, total: number, onGo: (page: number) => void): PageJump {
  const [draft, setDraft] = useState(String(page));
  const [problem, setProblem] = useState<string | null>(null);
  const problemId = useId();
  useEffect(() => {
    setDraft(String(page));
    setProblem(null);
  }, [page]);

  return {
    inputProps: {
      value: draft,
      inputMode: 'numeric',
      autoComplete: 'off',
      spellCheck: false,
      'aria-invalid': problem ? true : undefined,
      'aria-describedby': problem ? problemId : undefined,
      onChange: (event) => {
        setDraft(digitsOnly(event.target.value));
        setProblem(null);
      },
      onKeyDown: (event) => {
        if (event.key !== 'Enter') return;
        // Enter belongs to this box: no form, dialog or list behind it acts on it.
        event.preventDefault();
        event.stopPropagation();
        const why = pageJumpProblem(draft, total);
        if (why) {
          setProblem(why);
          event.currentTarget.select();
          return;
        }
        const n = pageFromInput(draft, total)!;
        setProblem(null);
        setDraft(String(n));
        onGo(n);
      },
      onBlur: () => {
        const n = pageFromInput(draft, total);
        if (n !== null && n !== page) onGo(n);
        setDraft(String(n ?? page));
        setProblem(null);
      },
    },
    problem,
    problemId,
  };
}
