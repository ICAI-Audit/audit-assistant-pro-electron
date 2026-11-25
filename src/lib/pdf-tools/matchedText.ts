// The JavaScript engine keeps, for the whole process, the last string a regular expression was run
// against and what it matched (RegExp.input / $_, lastMatch, leftContext, rightContext, $1-$9), until
// the next match anywhere. After a tool run or a file-name clean-up that is document text or a file
// name. PDF Tools clears them when its list is emptied for another engagement or user (workingList.ts
// setContext), at the end of every tool run (runTool.ts) and when a destination batch settles
// (destinations.ts).
//
// The reset itself is the Redact lane's (redactPatterns.ts clearRedactCaches, which also drops the
// page texts it keeps for a search); this only gives it a name for the rest of PDF Tools, so the logic
// lives in one place.
//
// The statics are process-wide: any other part of the application can leave its own text there
// afterwards. That is outside PDF Tools.
import { clearRedactCaches } from './redactPatterns';

/** Clears what the engine keeps of the last regular-expression match (and the redact search's page texts). */
export function forgetMatchedText(): void {
  clearRedactCaches();
}
