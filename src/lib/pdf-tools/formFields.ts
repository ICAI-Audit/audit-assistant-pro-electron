// Reading the parts of a PDF's interactive form (its /AcroForm field tree), shared by inspect.ts
// and organise.ts. Every walk is bounded, so a malformed file with a cycle cannot hang it.
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRef, type PDFContext, type PDFObject } from 'pdf-lib';

export const ACRO_FORM = PDFName.of('AcroForm');
export const FIELDS = PDFName.of('Fields');
export const KIDS = PDFName.of('Kids');
export const PARENT = PDFName.of('Parent');
const T = PDFName.of('T');
const FT = PDFName.of('FT');
const SIG = PDFName.of('Sig');

/** Deeper field trees than this are not followed. */
export const MAX_FIELD_DEPTH = 32;

export function asDict(context: PDFContext, object: PDFObject | undefined): PDFDict | undefined {
  const value = object instanceof PDFRef ? context.lookup(object) : object;
  return value instanceof PDFDict ? value : undefined;
}

export function asArray(context: PDFContext, object: PDFObject | undefined): PDFObject[] {
  const value = object instanceof PDFRef ? context.lookup(object) : object;
  return value instanceof PDFArray ? value.asArray() : [];
}

/** A kid in a field's /Kids is a field when it has a name or kids of its own; otherwise it is a widget. */
export function isFieldNode(dict: PDFDict): boolean {
  return dict.has(T) || dict.has(KIDS);
}

const BTN = PDFName.of('Btn');
const FF = PDFName.of('Ff');
const PUSH_BUTTON_FLAG = 1 << 16;

/** The value of an inheritable field entry: the field's own, else its nearest parent's. */
function inherited(context: PDFContext, dict: PDFDict, key: PDFName): PDFObject | undefined {
  let node: PDFDict | undefined = dict;
  for (let depth = 0; node && depth < MAX_FIELD_DEPTH; depth++) {
    const entry = node.get(key);
    if (entry !== undefined) return entry instanceof PDFRef ? context.lookup(entry) : entry;
    node = asDict(context, node.get(PARENT));
  }
  return undefined;
}

/** A push button holds no value (it only starts an action). */
export function isPushButton(context: PDFContext, dict: PDFDict): boolean {
  if (inherited(context, dict, FT) !== BTN) return false;
  const flags = inherited(context, dict, FF);
  return flags instanceof PDFNumber && (flags.asNumber() & PUSH_BUTTON_FLAG) !== 0;
}

/** Whether a field is a signature field; its type may be inherited from a parent. */
export function isSignatureField(context: PDFContext, dict: PDFDict): boolean {
  let node: PDFDict | undefined = dict;
  for (let depth = 0; node && depth < MAX_FIELD_DEPTH; depth++) {
    const entry = node.get(FT);
    const type = entry instanceof PDFRef ? context.lookup(entry) : entry;
    if (type !== undefined) return type === SIG;
    node = asDict(context, node.get(PARENT));
  }
  return false;
}
