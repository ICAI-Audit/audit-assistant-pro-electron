// What the progress bar says while Organise pages runs. The library reports pages one by one; for a
// file with names pdf-lib reads otherwise than readers do it may start again from page 1 (pageOrder.ts,
// fix round 1), which is said as a second pass so the bar never seems to go back for no reason. After
// the last page the library checks every page of the result against the original, with no report:
// the bar then says so (and moves without a measure).

export const CHECKING_PAGES = 'Checking every page against the original…';

/** A label for each reported page (from 1); a page earlier than the last one reported starts the second pass. */
export function pageLabeller(inPlace: boolean): (page: number, total: number) => string {
  const verb = inPlace ? 'Rotating' : 'Copying';
  let last = 0;
  let second = false;
  return (page, total) => {
    if (page < last) second = true;
    last = page;
    return `${verb} the pages${second ? ', second pass' : ''} (${page} of ${total})…`;
  };
}
