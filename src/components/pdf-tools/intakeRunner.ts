// Adds files to the working list one at a time, from the computer or from the Evidence Vault. No
// React here: the screen passes in what it needs (the store, the password prompt, progress and
// messages), so the rules can be unit-tested. A vault file is read only when its turn comes, and
// its recorded size is checked against the list limits first, its real length again once it is read.
//
// The list's context key and session are taken when a run starts, and every await is followed by
// a check. When the list has moved on (another engagement, sign-out) the run stops without a word,
// so nothing of one engagement is added to, or named in, another. When the user leaves the screen
// the run stops and says how many files were not added.
import { listHeldBytes } from '@/lib/pdf-tools/workingList';
import type { WorkingListStore } from '@/lib/pdf-tools/workingList';
import type { FileOrigin, WorkingFile } from '@/lib/pdf-tools/types';
import type { IntakeDeps, IntakeNotice, IntakeResult, IntakeSource } from './intake';
import { formatBytes, plainMessage } from './format';

export type IntakeStage = 'reading' | 'checking' | 'unlocking' | 'converting' | 'password';

export interface IntakeProgress {
  done: number;
  total: number;
  current: string;
  stage: IntakeStage;
}

/** The dialog's answer: the unlocked bytes, null to skip the file, or the error that refused it. */
export type PasswordAnswer = Uint8Array | null | Error;

export interface FileLike {
  name: string;
  /** For a vault file, the size recorded in the vault: the limits are checked before it is read. */
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  /** Where the file comes from; a File from the computer has neither of these. */
  origin?: Extract<FileOrigin, 'computer' | 'vault'>;
  evidenceId?: string;
}

export interface IntakeEnvironment {
  store: Pick<WorkingListStore, 'getState' | 'addFiles'>;
  prepare(source: IntakeSource, hooks: Pick<IntakeDeps, 'askPassword' | 'onStage' | 'pause'>): Promise<IntakeResult>;
  /** Shows the password dialog for one file. */
  askPassword(name: string, bytes: Uint8Array): Promise<PasswordAnswer>;
  /** Closes a password dialog that is open, as if skipped. */
  cancelPassword(): void;
  /** Resolves once the screen has had a chance to paint. */
  nextPaint(): Promise<void>;
  /** Lets other work run between slices of a conversion (default: a zero-delay timer). */
  yieldNow?(): Promise<void>;
  onProgress(progress: IntakeProgress | null): void;
  report: {
    notAdded(name: string, message: string): void;
    notice(name: string, notice: IntakeNotice): void;
    listLarge(): void;
    finished(summary: { added: number; notAdded: number }): void;
    stoppedOnLeave(remaining: number): void;
  };
  maxBytes: number;
  warnBytes: number;
}

class Abandoned extends Error {}

// What the list holds, a protected result's preview bytes included (workingList.ts heldBytes), as the store counts it.
const listSize = (files: readonly WorkingFile[]) => listHeldBytes(files);

export class IntakeRunner {
  private pending: FileLike[] = [];
  // Each run keeps its file in its own object, so an abandoned run that wakes up later can only
  // change its own, never the file of the run that replaced it.
  private currentRun: { file: FileLike | null } | null = null;
  private generation = 0;
  private active = false;

  constructor(private env: IntakeEnvironment) {}

  get running(): boolean {
    return this.active;
  }

  enqueue(files: FileLike[]): void {
    if (files.length === 0) return;
    this.pending.push(...files);
    if (!this.active) void this.run();
  }

  /** Stops the run. Only leaving the screen is announced; a context change is silent. */
  abandon(reason: 'context-changed' | 'left-screen'): void {
    const remaining = this.pending.length + (this.currentRun?.file ? 1 : 0);
    this.generation += 1;
    this.pending = [];
    this.currentRun = null;
    this.active = false;
    this.env.cancelPassword();
    this.env.onProgress(null);
    if (reason === 'left-screen' && remaining > 0) this.env.report.stoppedOnLeave(remaining);
  }

  private async run(): Promise<void> {
    const { env } = this;
    const generation = this.generation;
    const { contextKey: key, session } = env.store.getState();
    if (!key) {
      this.pending = [];
      return;
    }
    this.active = true;
    const mine: { file: FileLike | null } = { file: null };
    this.currentRun = mine;
    const live = () => this.generation === generation && env.store.getState().session === session;
    let done = 0;
    let added = 0;
    let notAdded = 0;
    let finished = true;

    try {
      while (this.pending.length > 0) {
        if (!live()) {
          finished = false;
          break;
        }
        const file = this.pending.shift()!;
        mine.file = file;
        const total = done + 1 + this.pending.length;
        const show = (stage: IntakeStage, current = file.name) => {
          if (!live()) throw new Abandoned();
          env.onProgress({ done, total, current, stage });
        };
        try {
          show('reading');
          await env.nextPaint();
          // The list may have moved on while the screen painted: then nothing about this file is said,
          // not even addOne's size messages (addOne runs straight after, with no await in between).
          if (!live()) throw new Abandoned();
          const result = await this.addOne(file, key, session, show, live);
          if (result === 'added') added += 1;
          else notAdded += 1;
        } catch (error) {
          if (error instanceof Abandoned || !live()) {
            finished = false;
            break;
          }
          notAdded += 1;
          env.report.notAdded(file.name, plainMessage(error));
        }
        done += 1;
        mine.file = null;
      }
    } finally {
      mine.file = null;
      if (this.generation === generation) {
        this.active = false;
        this.currentRun = null;
        if (!live()) this.pending = [];
        env.onProgress(null);
        if (finished && added + notAdded > 0) env.report.finished({ added, notAdded });
      }
    }
  }

  private async addOne(
    file: FileLike,
    key: string,
    session: number,
    show: (stage: IntakeStage, current?: string) => void,
    live: () => boolean,
  ): Promise<'added' | 'not-added'> {
    const { env } = this;
    const limit = formatBytes(env.maxBytes);
    const tooMuch = `The files in the list would come to more than ${limit}. Remove some files first.`;
    // The reason a file of this size cannot be added, or null.
    const refusal = (size: number): string | null => {
      if (size > env.maxBytes) return `This file is larger than ${limit}, the most PDF Tools can hold at once.`;
      return listSize(env.store.getState().files) + size > env.maxBytes ? tooMuch : null;
    };
    const before = listSize(env.store.getState().files);
    const refusedBySize = refusal(file.size);
    if (refusedBySize) {
      env.report.notAdded(file.name, refusedBySize);
      return 'not-added';
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!live()) throw new Abandoned();
    // A vault file's size is the one recorded in the vault (0 when none was): its real length is checked
    // too, before anything reads its content (inspect, unlock or convert).
    const refusedByLength = refusal(bytes.length);
    if (refusedByLength) {
      env.report.notAdded(file.name, refusedByLength);
      return 'not-added';
    }
    const source: IntakeSource = { name: file.name, bytes, origin: file.origin ?? 'computer' };
    if (file.origin === 'vault' && file.evidenceId) source.evidenceId = file.evidenceId;
    const yieldNow = env.yieldNow ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    let shownPage = 0;
    const result = await env.prepare(
      source,
      {
        onStage: async (stage) => {
          show(stage);
          await env.nextPaint();
          show(stage);
        },
        // Between slices of a TIFF conversion: stop at once if the list moved on, say the page when it
        // changes, and let the screen paint and take input.
        pause: async ({ page, pages }) => {
          if (!live()) throw new Abandoned();
          if (page !== shownPage && pages > 1) {
            shownPage = page;
            show('converting', `${file.name} (page ${page} of ${pages})`);
          }
          await yieldNow();
          if (!live()) throw new Abandoned();
        },
        askPassword: async (name, locked) => {
          show('password');
          const answer = await env.askPassword(name, locked);
          if (answer instanceof Error) throw answer;
          return answer;
        },
      },
    );
    if (!live()) throw new Abandoned();
    if (result.status !== 'ready') return 'not-added';

    const outcome = env.store.addFiles(key, [result.file], session);
    if (outcome.added === 0 && outcome.refused === 0) throw new Abandoned(); // the list moved on
    if (outcome.refused > 0) {
      env.report.notAdded(file.name, tooMuch);
      return 'not-added';
    }
    if (result.notice) env.report.notice(file.name, result.notice);
    if (outcome.overWarn && before <= env.warnBytes) env.report.listLarge();
    return 'added';
  }
}
