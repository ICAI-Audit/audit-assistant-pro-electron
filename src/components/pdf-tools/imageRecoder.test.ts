import { describe, expect, it } from 'vitest';
import type { RecodeRequest } from '@/lib/pdf-tools/compress';
import { validRecodeRequest } from './imageRecoder';

const raw = (width: number, height: number, channels: 1 | 3 = 3): RecodeRequest => ({
  source: { kind: 'raw', bytes: new Uint8Array(width * height * channels), channels },
  width,
  height,
  targetWidth: Math.max(1, Math.floor(width / 2)),
  targetHeight: Math.max(1, Math.floor(height / 2)),
  quality: 0.68,
  grayscale: channels === 1,
});

describe('validRecodeRequest', () => {
  it('accepts a normal request', () => {
    expect(validRecodeRequest(raw(100, 80))).toBe(true);
    expect(validRecodeRequest({ ...raw(100, 80), source: { kind: 'jpeg', bytes: new Uint8Array([0xff, 0xd8]) } })).toBe(true);
  });

  it('refuses sizes that are not whole positive numbers', () => {
    expect(validRecodeRequest({ ...raw(100, 80), targetWidth: 0 })).toBe(false);
    expect(validRecodeRequest({ ...raw(100, 80), targetHeight: 10.5 })).toBe(false);
    expect(validRecodeRequest({ ...raw(100, 80), width: Number.NaN })).toBe(false);
  });

  it('refuses a target larger than the source or than a canvas side', () => {
    expect(validRecodeRequest({ ...raw(100, 80), targetWidth: 101 })).toBe(false);
    const wide: RecodeRequest = { ...raw(10, 10), width: 9000, height: 10, targetWidth: 8193, targetHeight: 10, source: { kind: 'jpeg', bytes: new Uint8Array(4) } };
    expect(validRecodeRequest(wide)).toBe(false);
  });

  it('refuses a source of more than 64 megapixels', () => {
    const big: RecodeRequest = { ...raw(10, 10), width: 8001, height: 8001, targetWidth: 100, targetHeight: 100, source: { kind: 'jpeg', bytes: new Uint8Array(4) } };
    expect(validRecodeRequest(big)).toBe(false);
  });

  it('refuses a quality outside 0..1', () => {
    expect(validRecodeRequest({ ...raw(10, 10), quality: 0 })).toBe(false);
    expect(validRecodeRequest({ ...raw(10, 10), quality: 1.2 })).toBe(false);
  });

  it('refuses raw samples that are too few, and an empty JPEG', () => {
    const short = raw(10, 10);
    expect(validRecodeRequest({ ...short, source: { kind: 'raw', bytes: new Uint8Array(299), channels: 3 } })).toBe(false);
    expect(validRecodeRequest({ ...short, source: { kind: 'jpeg', bytes: new Uint8Array() } })).toBe(false);
  });
});
