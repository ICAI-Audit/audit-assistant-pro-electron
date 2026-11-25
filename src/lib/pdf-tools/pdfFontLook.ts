// How a PDF font looks, for the conversion tools (PDF to Word, PDF to Excel; design 5.11): the family a
// reader would name, and whether it is bold or italic. Read from the font's own dictionary with pdf-lib:
// its base name ("ABCDEF+Arial-BoldMT"), its descriptor's flags and weight, and, when the name says
// nothing (many writers name an embedded font "CIDFont+F1"), the embedded font file's own name and weight
// tables. Nothing here draws, measures or keeps a font.
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFStream } from 'pdf-lib';
import { decodeStreamBytes } from './marks';

/**
 * The sign the standard symbol font ZapfDingbats draws for a character code (its own fixed encoding), as text any
 * font of signs can show; null for a code it has no sign for.
 */
export function dingbatSign(code: number): string | null {
  const odd: Record<number, number> = { 0x25: 0x260e, 0x2a: 0x261b, 0x2b: 0x261e, 0x48: 0x2605, 0x6c: 0x25cf, 0x6e: 0x25a0, 0x73: 0x25b2, 0x74: 0x25bc, 0x75: 0x25c6, 0x77: 0x25d7, 0xa8: 0x2663, 0xa9: 0x2666, 0xaa: 0x2665, 0xab: 0x2660, 0xd4: 0x2794, 0xd5: 0x2192, 0xd6: 0x2194, 0xd7: 0x2195 };
  let point: number | null = null;
  if (odd[code] !== undefined) point = odd[code];
  else if (code >= 0x21 && code <= 0x7e) point = 0x2700 + code - 0x20;
  else if (code >= 0xa1 && code <= 0xa7) point = 0x2761 + code - 0xa1;
  else if (code >= 0xac && code <= 0xb5) point = 0x2460 + code - 0xac;
  else if (code >= 0xb6 && code <= 0xbf) point = 0x2776 + code - 0xb6;
  else if (code >= 0xc0 && code <= 0xc9) point = 0x2780 + code - 0xc0;
  else if (code >= 0xca && code <= 0xd3) point = 0x278a + code - 0xca;
  else if (code >= 0xd8 && code <= 0xef) point = 0x2798 + code - 0xd8;
  else if (code >= 0xf1 && code <= 0xfe) point = 0x27b1 + code - 0xf1;
  return point === null ? null : String.fromCharCode(point);
}

export interface FontLook {
  /**
   * 'dingbats' for the standard symbol font used as it is: its text is character codes of its own encoding
   * (dingbatSign). 'rupee' for a font that names itself a rupee font (the fonts made to draw the rupee sign at a
   * letter's place carry no glyph names and no table of meanings; their name is all they say): the one letter a
   * page sets in such a font is the rupee sign.
   */
  signs?: 'dingbats' | 'rupee';
  /** A family Windows ships, the nearest of the same class when the font's own is not one of them. */
  family: string;
  bold: boolean;
  italic: boolean;
}

/** Families Windows ships (and the names other writers give their look-alikes), by name without spaces, in small letters. */
const FAMILIES: Readonly<Record<string, string>> = {
  arial: 'Arial', helvetica: 'Arial', helveticaneue: 'Arial', liberationsans: 'Arial', nimbussans: 'Arial', nimbussansl: 'Arial', arimo: 'Arial',
  roboto: 'Arial', opensans: 'Arial', notosans: 'Arial', lato: 'Arial', sourcesanspro: 'Arial', dejavusans: 'Verdana',
  arialnarrow: 'Arial Narrow', arialblack: 'Arial Black',
  timesnewroman: 'Times New Roman', times: 'Times New Roman', timesroman: 'Times New Roman', liberationserif: 'Times New Roman',
  nimbusroman: 'Times New Roman', nimbusromno9l: 'Times New Roman', tinos: 'Times New Roman', notoserif: 'Times New Roman', dejavuserif: 'Georgia',
  couriernew: 'Courier New', courier: 'Courier New', liberationmono: 'Courier New', nimbusmono: 'Courier New', cousine: 'Courier New', dejavusansmono: 'Consolas',
  calibri: 'Calibri', carlito: 'Calibri', calibrilight: 'Calibri Light', cambria: 'Cambria', caladea: 'Cambria', candara: 'Candara', consolas: 'Consolas',
  constantia: 'Constantia', corbel: 'Corbel', verdana: 'Verdana', tahoma: 'Tahoma', georgia: 'Georgia', trebuchet: 'Trebuchet MS', trebuchetms: 'Trebuchet MS',
  segoeui: 'Segoe UI', garamond: 'Garamond', bookmanoldstyle: 'Bookman Old Style', bookantiqua: 'Book Antiqua', centurygothic: 'Century Gothic',
  century: 'Century', centuryschoolbook: 'Century Schoolbook', palatinolinotype: 'Palatino Linotype', palatino: 'Palatino Linotype',
  lucidasans: 'Lucida Sans', lucidasansunicode: 'Lucida Sans Unicode', lucidaconsole: 'Lucida Console', comicsansms: 'Comic Sans MS',
  franklingothicmedium: 'Franklin Gothic Medium', gillsansmt: 'Gill Sans MT', gillsans: 'Gill Sans MT', impact: 'Impact', symbol: 'Symbol',
  // Fonts of signs: their letters are signs (a tick, a box, an arrow), so the text keeps its font.
  wingdings: 'Wingdings', wingdings2: 'Wingdings 2', wingdings3: 'Wingdings 3', webdings: 'Webdings',
  mangal: 'Mangal', nirmalaui: 'Nirmala UI', kokila: 'Kokila', aparajita: 'Aparajita', utsaah: 'Utsaah', microsoftsansserif: 'Microsoft Sans Serif',
  sylfaen: 'Sylfaen', cambriamath: 'Cambria Math', rockwell: 'Rockwell', perpetua: 'Perpetua', baskervilleoldface: 'Baskerville Old Face',
};

/** A font's own name saying that it draws the rupee sign. */
const RUPEE_FONT = /rupee/i;
/** The rupee sign. */
export const RUPEE_SIGN = '₹';
const BOLD_WORD = /bold|black|heavy|semibold|demi|extrabold/i;
const ITALIC_WORD = /italic|oblique|slanted/i;
/** An embedded font file larger than this is not opened for its name. */
const MAX_FONT_FILE = 8_000_000;

const compact = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A family and style from a name as fonts write it: "Arial-BoldMT", "Times New Roman,Italic", "TrebuchetMS". */
function fromName(name: string): { family: string | null; bold: boolean; italic: boolean } {
  const plain = name.replace(/^[A-Z]{6}\+/, '');
  const cut = plain.search(/[-,]/);
  const head = cut < 0 ? plain : plain.slice(0, cut);
  const tail = cut < 0 ? '' : plain.slice(cut + 1);
  let key = compact(head);
  let family = FAMILIES[key] ?? null;
  // "ArialMT", "TimesNewRomanPSMT", "CourierNewPS", "Arial Bold" written as one word.
  for (const end of ['psmt', 'mt', 'ps', 'regular', 'bolditalic', 'bold', 'italic', 'oblique']) {
    if (family) break;
    if (key.endsWith(end)) {
      const shorter = key.slice(0, -end.length);
      if (FAMILIES[shorter]) {
        key = shorter;
        family = FAMILIES[shorter];
      }
    }
  }
  const style = `${tail} ${head.slice(Math.max(0, head.length - 12))}`;
  return { family, bold: BOLD_WORD.test(tail) || /Bold(?:Italic|Oblique|MT)?$/.test(head), italic: ITALIC_WORD.test(style) };
}

const u16 = (b: Uint8Array, at: number): number => (at + 1 < b.length ? (b[at] << 8) | b[at + 1] : 0);
const u32 = (b: Uint8Array, at: number): number => (at + 3 < b.length ? ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0 : 0);

/** The family name, weight and slant an embedded TrueType or OpenType font file states about itself. */
export function fontFileLook(bytes: Uint8Array): { family: string | null; bold: boolean; italic: boolean } | null {
  if (bytes.length < 12) return null;
  const tag = u32(bytes, 0);
  if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) return null;
  const count = u16(bytes, 4);
  const tables = new Map<string, number>();
  for (let i = 0; i < count && 12 + i * 16 + 16 <= bytes.length; i++) {
    const at = 12 + i * 16;
    tables.set(String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]), u32(bytes, at + 8));
  }
  let bold = false;
  let italic = false;
  let known = false;
  const os2 = tables.get('OS/2');
  if (os2 !== undefined && os2 + 64 <= bytes.length) {
    const selection = u16(bytes, os2 + 62);
    bold = u16(bytes, os2 + 4) >= 600 || (selection & 32) !== 0;
    italic = (selection & 1) !== 0;
    known = true;
  }
  const head = tables.get('head');
  if (!known && head !== undefined && head + 46 <= bytes.length) {
    const mac = u16(bytes, head + 44);
    bold = (mac & 1) !== 0;
    italic = (mac & 2) !== 0;
    known = true;
  }
  let family: string | null = null;
  const name = tables.get('name');
  if (name !== undefined && name + 6 <= bytes.length) {
    const records = u16(bytes, name + 2);
    const strings = name + u16(bytes, name + 4);
    let rank = 0;
    for (let i = 0; i < records && i < 400; i++) {
      const at = name + 6 + i * 12;
      if (at + 12 > bytes.length) break;
      const platform = u16(bytes, at);
      const language = u16(bytes, at + 4);
      if (u16(bytes, at + 6) !== 1) continue;
      // English (Windows, United States) first, then any Windows or Unicode name, then a Macintosh one.
      const r = platform === 3 && language === 0x409 ? 4 : platform === 3 || platform === 0 ? 3 : platform === 1 && language === 0 ? 2 : 1;
      if (r <= rank) continue;
      const from = strings + u16(bytes, at + 10);
      const length = u16(bytes, at + 8);
      if (from + length > bytes.length || length === 0 || length > 200) continue;
      let text = '';
      if (platform === 1) for (let k = 0; k < length; k++) text += String.fromCharCode(bytes[from + k]);
      else for (let k = 0; k + 1 < length; k += 2) text += String.fromCharCode(u16(bytes, from + k));
      family = text;
      rank = r;
    }
  }
  return known || family ? { family, bold, italic } : null;
}

function descriptorOf(font: PDFDict): PDFDict | undefined {
  const own = font.lookup(PDFName.of('FontDescriptor'));
  if (own instanceof PDFDict) return own;
  const below = font.lookup(PDFName.of('DescendantFonts'));
  if (below instanceof PDFArray && below.size() > 0) {
    const first = below.lookup(0);
    const d = first instanceof PDFDict ? first.lookup(PDFName.of('FontDescriptor')) : undefined;
    if (d instanceof PDFDict) return d;
  }
  return undefined;
}

const numberOf = (dict: PDFDict | undefined, key: string): number | null => {
  const v = dict?.lookup(PDFName.of(key));
  return v instanceof PDFNumber ? v.asNumber() : null;
};

/**
 * The look of a font from its dictionary. The family is always one Windows ships: the font's own when it
 * is one of them, else Courier New for a fixed-pitch font, Times New Roman for one with serifs, else Arial.
 * Never throws: a font built in a way not expected here is a plain Arial.
 */
export function fontLook(font: PDFDict): FontLook {
  try {
    const base = font.lookup(PDFName.of('BaseFont'));
    const named = fromName(base instanceof PDFName ? base.decodeText() : '');
    const descriptor = descriptorOf(font);
    const flags = numberOf(descriptor, 'Flags') ?? 0;
    const weight = numberOf(descriptor, 'FontWeight') ?? 0;
    const angle = numberOf(descriptor, 'ItalicAngle') ?? 0;
    let family = named.family;
    let bold = named.bold || weight >= 600 || (flags & (1 << 18)) !== 0;
    let italic = named.italic || (flags & 64) !== 0 || Math.abs(angle) > 1;
    if (!family && descriptor) {
      for (const key of ['FontFile2', 'FontFile3']) {
        const file = descriptor.lookup(PDFName.of(key));
        if (!(file instanceof PDFStream) || file.getContentsSize() > MAX_FONT_FILE) continue;
        const bytes = decodeStreamBytes(file);
        const look = bytes ? fontFileLook(bytes) : null;
        if (!look) continue;
        const own = look.family ? fromName(look.family) : null;
        family = own?.family ?? null;
        bold = bold || look.bold || (own?.bold ?? false);
        italic = italic || look.italic;
        break;
      }
    }
    if (!family) family = (flags & 1) !== 0 ? 'Courier New' : (flags & 2) !== 0 ? 'Times New Roman' : 'Arial';
    // The standard symbol font, used as it is (no font file, no table of its own for what its codes mean).
    const name = base instanceof PDFName ? base.decodeText().replace(/^[A-Z]{6}\+/, '') : '';
    const standardSigns = name === 'ZapfDingbats' && !font.has(PDFName.of('ToUnicode')) && !descriptor;
    if (standardSigns) return { family, bold, italic, signs: 'dingbats' };
    return RUPEE_FONT.test(name) ? { family, bold, italic, signs: 'rupee' } : { family, bold, italic };
  } catch {
    return { family: 'Arial', bold: false, italic: false };
  }
}
