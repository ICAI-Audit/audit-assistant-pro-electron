// The search matches on the page shown, drawn over the page in the place PageSurface keeps for a text
// layer: each quad mapped to the page box with the viewer's single mapping (ViewerSurface), so they sit
// on the words at every zoom, page /Rotate and view turn. Multiplied with the page, so the words stay
// readable through the colour; the current match is orange with an outline, the others yellow.
import type { ViewerSurface } from './pageGeometry';
import type { Quad } from './searchGeometry';
import type { SearchHighlight } from './useViewerSearch';

const round = (n: number) => Math.round(n * 100) / 100;

function pathOf(surface: ViewerSurface, quads: readonly Quad[]): string {
  let d = '';
  for (const quad of quads) {
    quad.forEach(([x, y], k) => {
      const [cx, cy] = surface.toCss(x, y);
      d += `${k === 0 ? 'M' : 'L'}${round(cx)} ${round(cy)} `;
    });
    d += 'Z ';
  }
  return d.trim();
}

export default function SearchHighlights({ surface, highlights }: { surface: ViewerSurface; highlights: readonly SearchHighlight[] }) {
  if (highlights.length === 0) return null;
  return (
    <svg
      aria-hidden="true"
      data-testid="pdf-tools-viewer-search-highlights"
      className="pointer-events-none absolute inset-0 overflow-visible"
      width={surface.width}
      height={surface.height}
      style={{ mixBlendMode: 'multiply' }}
    >
      {/* The current match last, so its outline is on top. */}
      {highlights.map((h, k) => ({ h, k })).sort((a, b) => Number(a.h.current) - Number(b.h.current)).map(({ h, k }) =>
        h.current ? (
          <path key={k} d={pathOf(surface, h.quads)} data-testid="pdf-tools-viewer-search-hit" data-current="true" fill="rgb(251 146 60)" stroke="rgb(234 88 12)" strokeWidth={1.5} strokeLinejoin="round" />
        ) : (
          <path key={k} d={pathOf(surface, h.quads)} data-testid="pdf-tools-viewer-search-hit" fill="rgb(253 224 71)" />
        ),
      )}
    </svg>
  );
}
