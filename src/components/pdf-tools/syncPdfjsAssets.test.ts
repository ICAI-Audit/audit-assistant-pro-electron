import { describe, expect, it } from 'vitest';

interface SwapFs {
  existsSync(path: string): boolean;
  renameSync(from: string, to: string): void;
  rmSync(path: string, options?: unknown): void;
}
type SwapIn = (fs: SwapFs, staging: string, target: string, previous: string) => string | null;

// The script exports its swap step; importing it does not run the copy.
const loadSwap = async (): Promise<SwapIn> => {
  const url = new URL('../../../scripts/sync-pdfjs-assets.mjs', import.meta.url).href;
  return ((await import(/* @vite-ignore */ url)) as { swapIn: SwapIn }).swapIn;
};

function fakeFs(fail: { staging?: boolean; restore?: boolean; removeOld?: boolean } = {}) {
  const folders = new Set(['target', 'staging']);
  const fs: SwapFs = {
    existsSync: (p) => folders.has(p),
    rmSync: (p) => {
      if (fail.removeOld && p === 'target.old' && folders.has(p)) throw new Error('EBUSY old');
      folders.delete(p);
    },
    renameSync: (from, to) => {
      if (from === 'staging' && fail.staging) throw new Error('EPERM staging');
      if (from === 'target.old' && fail.restore) throw new Error('EPERM restore');
      folders.delete(from);
      folders.add(to);
    },
  };
  return { fs, folders };
}

type IsRunDirectly = (argv1: string | undefined, moduleUrl: string, realpath: (path: string) => string) => boolean;
const loadIsRunDirectly = async (): Promise<IsRunDirectly> => {
  const url = new URL('../../../scripts/sync-pdfjs-assets.mjs', import.meta.url).href;
  return ((await import(/* @vite-ignore */ url)) as { isRunDirectly: IsRunDirectly }).isRunDirectly;
};

describe('sync-pdfjs-assets: does it run, or was it imported?', () => {
  const real = 'C:\\repo\\scripts\\sync-pdfjs-assets.mjs';
  const moduleUrl = 'file:///C:/repo/scripts/sync-pdfjs-assets.mjs';
  // A junction (or symbolic link) C:\link -> C:\repo: Node reports the module at its real path.
  const realpath = (p: string) => p.replace(/^C:\\link\\/i, 'C:\\repo\\');

  it('runs when started through a junction or link', async () => {
    const isRunDirectly = await loadIsRunDirectly();
    expect(isRunDirectly('C:\\link\\scripts\\sync-pdfjs-assets.mjs', moduleUrl, realpath)).toBe(true);
  });

  it('runs when started directly, whatever the case of the drive letter', async () => {
    const isRunDirectly = await loadIsRunDirectly();
    expect(isRunDirectly(real, moduleUrl, realpath)).toBe(true);
    expect(isRunDirectly('c:\\repo\\scripts\\sync-pdfjs-assets.mjs', moduleUrl, realpath)).toBe(process.platform === 'win32');
  });

  it('does not run when imported (by the tests or another script)', async () => {
    const isRunDirectly = await loadIsRunDirectly();
    expect(isRunDirectly('C:\\repo\\node_modules\\vitest\\vitest.mjs', moduleUrl, realpath)).toBe(false);
    expect(isRunDirectly(undefined, moduleUrl, realpath)).toBe(false);
  });

  it('falls back to the path as given when it cannot be resolved', async () => {
    const isRunDirectly = await loadIsRunDirectly();
    const failing = () => {
      throw new Error('ENOENT');
    };
    expect(isRunDirectly(real, moduleUrl, failing)).toBe(true);
    expect(isRunDirectly('C:\\elsewhere\\x.mjs', moduleUrl, failing)).toBe(false);
  });
});

describe('sync-pdfjs-assets swap', () => {
  it('puts the new copy in place and removes the old one', async () => {
    const swapIn = await loadSwap();
    const { fs, folders } = fakeFs();
    expect(swapIn(fs, 'staging', 'target', 'target.old')).toBeNull();
    expect([...folders]).toEqual(['target']);
  });

  it('puts the old copy back when the new one cannot be moved in', async () => {
    const swapIn = await loadSwap();
    const { fs, folders } = fakeFs({ staging: true });
    expect(() => swapIn(fs, 'staging', 'target', 'target.old')).toThrow('Copy failed, the previous files were left in place: EPERM staging');
    expect(folders.has('target')).toBe(true);
  });

  it('says where the old copy is when it cannot be put back either', async () => {
    const swapIn = await loadSwap();
    const { fs, folders } = fakeFs({ staging: true, restore: true });
    let message = '';
    try {
      swapIn(fs, 'staging', 'target', 'target.old');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(folders.has('target')).toBe(false);
    expect(message).toBe(
      'Copy failed, and the previous files could not be put back. They are in target.old: rename that folder to target. (EPERM staging; EPERM restore)',
    );
    expect(message).not.toMatch(/left in place/);
  });

  it('warns, without failing, when the old copy cannot be deleted', async () => {
    const swapIn = await loadSwap();
    const { fs } = fakeFs({ removeOld: true });
    expect(swapIn(fs, 'staging', 'target', 'target.old')).toBe('The new files are in place, but the old copy could not be deleted: target.old (EBUSY old)');
  });
});
