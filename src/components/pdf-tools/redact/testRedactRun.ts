// TEST HELPER (Redact run, Task A9): the application's renderer, codecs and painter, made with pdf.js's
// legacy build and its Node canvas, so the run can be tested in Node exactly as it runs in the
// application (the same functions, in the same shapes as pdfRenderer.ts). Never imported by the app.
import * as zlib from 'node:zlib';
import type { FontStyleLike, TextItemLike } from '@/lib/pdf-tools/pageText';
import type { AnnotationText } from '@/lib/pdf-tools/redactFind';
import { openPdfjs, standardMeasure, type PdfjsDocument } from '@/lib/pdf-tools/testRedactPdf';
import type { PagePixels, PictureCodecs } from './pageEncode';
import type { RenderedPixels, TextPainter } from './redactPages';
import type { RedactEnv } from './redactRun';
import { opIdsOf, readOperations, type OperatorList, type TextOp, type ViewFont } from './rendererView';

interface NodeCanvas {
  canvas: { width: number; height: number; encode(format: 'jpeg', quality: number): Promise<Uint8Array> };
  context: CanvasRenderingContext2D;
}

type RawAnnotation = {
  subtype?: string;
  rect?: number[];
  annotationFlags?: number;
  contentsObj?: { str?: unknown };
  titleObj?: { str?: unknown };
  textContent?: unknown;
  fieldValue?: unknown;
  url?: unknown;
  unsafeUrl?: unknown;
  alternativeText?: unknown;
  options?: { displayValue?: unknown; exportValue?: unknown }[];
};

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** pdfRenderer.ts annotationText, the same order and rules. */
function annotationText(a: RawAnnotation): AnnotationText {
  const texts: unknown[] = [a.contentsObj?.str, a.titleObj?.str];
  if (Array.isArray(a.textContent)) texts.push(...(a.textContent as unknown[]));
  if (Array.isArray(a.fieldValue)) texts.push(...(a.fieldValue as unknown[]));
  else texts.push(a.fieldValue);
  texts.push(a.url, a.unsafeUrl, a.alternativeText);
  if (Array.isArray(a.options)) for (const option of a.options) texts.push(option?.displayValue, option?.exportValue);
  return { subtype: a.subtype ?? '', rect: a.rect ? [...a.rect] : [0, 0, 0, 0], flags: a.annotationFlags ?? 0, texts: texts.filter(isText) };
}

/** What pdf.js's page proxy keeps after a drawing (the parts read here; pdfRenderer.ts reads the same). */
interface DrawnPage {
  recordedBBoxes: { length: number; isEmpty(i: number): boolean; minX(i: number): number; minY(i: number): number; maxX(i: number): number; maxY(i: number): number } | null;
  commonObjs: { has(id: string): boolean; get(id: string): unknown };
  objs: { has(id: string): boolean; get(id: string): unknown };
  _intentStates: Map<string, { operatorList?: OperatorList }>;
  _transport: { getRenderingIntent(intent: string, annotationMode: number): { cacheKey: string } };
}

/** The operations that painted text in the drawing just made of `page` (pdfRenderer.ts readDrawnOperations, the same). */
async function readDrawnOperations(page: DrawnPage, width: number, height: number): Promise<TextOp[]> {
  const { AnnotationMode, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const key = page._transport.getRenderingIntent('display', AnnotationMode.ENABLE).cacheKey;
  const list = page._intentStates.get(key)?.operatorList;
  if (!list) return [];
  const boxes = page.recordedBBoxes;
  const font = (name: string): ViewFont | null => {
    for (const pool of [page.commonObjs, page.objs]) if (pool.has(name)) return pool.get(name) as ViewFont;
    return null;
  };
  // A box of the whole drawing says nothing (pdf.js records that when it cannot measure the text).
  const box = (i: number) => {
    if (!boxes || i >= boxes.length || boxes.isEmpty(i)) return null;
    const b = { left: Math.floor(boxes.minX(i) * width), top: Math.floor(boxes.minY(i) * height), right: Math.ceil(boxes.maxX(i) * width), bottom: Math.ceil(boxes.maxY(i) * height) };
    return (b.right - b.left) * (b.bottom - b.top) >= 0.98 * width * height || !(b.right > b.left && b.bottom > b.top) ? null : b;
  };
  return readOperations(list, opIdsOf(OPS as unknown as Record<string, number>), font, box);
}

export interface NodeEnv extends RedactEnv {
  /** A canvas of pdf.js's Node factory (for drawing and encoding in tests). */
  canvas(width: number, height: number): Promise<NodeCanvas>;
  /** Calls made to the renderer, by function (for the tests' counts). */
  calls: Record<string, number>;
  close(): Promise<void>;
}

/** A RedactEnv on pdf.js in Node: documents opened once per byte array, pages drawn with rotation 0 on white. */
export async function nodeEnv(): Promise<NodeEnv> {
  const docs = new Map<Uint8Array, Promise<PdfjsDocument>>();
  const open = (file: Uint8Array) => {
    let doc = docs.get(file);
    if (!doc) docs.set(file, (doc = openPdfjs(file)));
    return doc;
  };
  const calls: Record<string, number> = {};
  const count = (name: string) => (calls[name] = (calls[name] ?? 0) + 1);
  const measure = await standardMeasure();
  let factoryDoc: PdfjsDocument | null = null;
  const canvas = async (w: number, h: number): Promise<NodeCanvas> => {
    if (!factoryDoc) {
      const { PDFDocument } = await import('pdf-lib');
      const d = await PDFDocument.create();
      d.addPage([10, 10]);
      factoryDoc = await openPdfjs(await d.save());
    }
    return (factoryDoc as unknown as { canvasFactory: { create(w: number, h: number): NodeCanvas } }).canvasFactory.create(w, h);
  };
  const abortIf = (signal?: AbortSignal) => {
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  };
  // A first canvas, so the painter and the codecs can work synchronously where the app's do.
  const scratch = await canvas(8, 8);

  const env: NodeEnv = {
    calls,
    canvas,
    measure,
    renderer: {
      async pageTextContent(file, pageIndex, options) {
        count('pageTextContent');
        abortIf(options?.signal);
        const page = await (await open(file)).getPage(pageIndex + 1);
        const content = await page.getTextContent();
        const items: TextItemLike[] = [];
        for (const item of content.items) {
          if (!('str' in item)) continue;
          items.push({ str: item.str, transform: item.transform, width: item.width, height: item.height, fontName: item.fontName, hasEOL: item.hasEOL });
        }
        const styles: Record<string, FontStyleLike> = {};
        for (const [name, style] of Object.entries(content.styles)) styles[name] = { fontFamily: style.fontFamily, ascent: style.ascent, descent: style.descent, vertical: style.vertical };
        return { items, styles };
      },
      async pageGeometries(file, options) {
        count('pageGeometries');
        abortIf(options?.signal);
        const doc = await open(file);
        const out: { view: [number, number, number, number]; rotate: number; userUnit: number }[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const [x0, y0, x1, y1] = page.view;
          out.push({ view: [x0, y0, x1, y1], rotate: page.rotate, userUnit: (page as unknown as { userUnit?: number }).userUnit ?? 1 });
        }
        return out;
      },
      async pageAnnotationTexts(file, pageIndex, options) {
        count('pageAnnotationTexts');
        abortIf(options?.signal);
        const page = await (await open(file)).getPage(pageIndex + 1);
        return ((await page.getAnnotations({ intent: 'display' })) as RawAnnotation[]).map(annotationText);
      },
      async renderPagePixels(file, pageIndex, scale, options): Promise<RenderedPixels> {
        count('renderPagePixels');
        abortIf(options?.signal);
        const page = await (await open(file)).getPage(pageIndex + 1);
        const viewport = page.getViewport({ scale, rotation: 0 });
        const width = Math.max(1, Math.floor(viewport.width));
        const height = Math.max(1, Math.floor(viewport.height));
        const { canvas: c, context } = await canvas(width, height);
        const skip = options?.skip;
        // pdfRenderer.ts renderPagePixels, the same: recordOperations to read, operationsFilter to skip.
        const proxy = page as unknown as { recordedBBoxes: unknown };
        if (options?.read) proxy.recordedBBoxes = null;
        await page.render({ canvas: c, canvasContext: context, viewport, background: 'rgb(255,255,255)', ...(options?.read ? { recordOperations: true } : {}), ...(skip ? { operationsFilter: (i: number) => !skip.has(i) } : {}) } as never).promise;
        const data = context.getImageData(0, 0, width, height).data;
        // Let the canvas go now, as pdfRenderer.ts does (releaseCanvas): its memory is outside the heap.
        c.width = 0;
        c.height = 0;
        const [x0, y0, x1, y1] = page.view;
        const textOps = options?.read ? await readDrawnOperations(page as unknown as DrawnPage, width, height) : undefined;
        return { data, width, height, scale, view: [x0, y0, x1, y1], userUnit: (page as unknown as { userUnit?: number }).userUnit ?? 1, transform: [...viewport.transform], ...(textOps ? { textOps } : {}) };
      },
    },
    codecs: (): PictureCodecs => ({
      deflate: async (samples) => new Uint8Array(zlib.deflateSync(samples)),
      async jpeg(px: PagePixels) {
        const { canvas: c, context } = await canvas(px.width, px.height);
        const image = context.createImageData(px.width, px.height);
        image.data.set(px.data);
        context.putImageData(image, 0, 0);
        return new Uint8Array(await c.encode('jpeg', 85));
      },
    }),
    painter: (): TextPainter => ({
      advance(text) {
        scratch.context.font = 'bold 100px sans-serif';
        return scratch.context.measureText(text).width / 100;
      },
      paint(text, sizePx, w, h, angle) {
        // The Node canvas is made asynchronously; draw on a canvas of the scratch's factory, made now.
        const factory = (factoryDoc as unknown as { canvasFactory: { create(w: number, h: number): NodeCanvas } }).canvasFactory;
        const { context } = factory.create(w, h);
        context.fillStyle = '#000000';
        context.fillRect(0, 0, w, h);
        context.fillStyle = '#ffffff';
        context.font = `bold ${sizePx}px sans-serif`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.translate(w / 2, h / 2);
        context.rotate((-angle * Math.PI) / 180);
        context.fillText(text, 0, 0);
        return context.getImageData(0, 0, w, h).data;
      },
    }),
    async close() {
      for (const doc of docs.values()) await (await doc).destroy();
      docs.clear();
      if (factoryDoc) await factoryDoc.destroy();
    },
  };
  return env;
}

const lum = (d: Uint8ClampedArray, i: number) => 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];

/**
 * The end-to-end review's measure (redact-e2e-review.md, "Visible px"): the value's ink is where the
 * page `visible` differs from its twin `hidden` (the same file with only the value made invisible);
 * `left` counts ink pixels that look the same in `result` and lie within 2 px of a clearly different
 * pixel (so not inside a solid box). Drawn at `dpi` with the run's own renderer.
 */
export async function inkLeft(env: RedactEnv, visible: Uint8Array, hidden: Uint8Array, result: Uint8Array, page: number, dpi = 200): Promise<{ ink: number; left: number }> {
  const scale = dpi / 72;
  const [v, h, r] = [await env.renderer.renderPagePixels(visible, page, scale), await env.renderer.renderPagePixels(hidden, page, scale), await env.renderer.renderPagePixels(result, page, scale)];
  if (v.width !== r.width || v.height !== r.height || v.width !== h.width || v.height !== h.height) return { ink: -1, left: -1 };
  const W = v.width;
  const H = v.height;
  let ink = 0;
  let left = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (Math.abs(lum(v.data, i) - lum(h.data, i)) < 60) continue;
      ink++;
      if (Math.abs(lum(r.data, i) - lum(v.data, i)) > 50) continue;
      let light = false;
      for (let dy = -2; dy <= 2 && !light; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          if (Math.abs(lum(r.data, yy * W + xx) - lum(v.data, i)) > 100) {
            light = true;
            break;
          }
        }
      }
      if (light) left++;
    }
  }
  return { ink, left };
}
