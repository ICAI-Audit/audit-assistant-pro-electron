// The accidents of the office's fillable file that the application does not copy (build-plan decision A3).
// Each switch is set to the application's behaviour; the other setting is the file's own behaviour.
// - chainedCalcUsesFreshValue: in a row with two calculated columns (S39) the second reads the first
//   one's new figure. The file reads the figure the first held before the keystroke (one step behind).
// - deleteControlOnEveryRowTable: every table that takes added rows can delete a row. The file has no
//   delete control on S38, S41a, S41b, S41c, S46, S50a, S50b and S50c.
// - showAllSchedulesAffectsExport: "Show all schedules" changes what is shown and counted, not what is
//   exported. In the file it also exports the schedules whose answer is "No".
export const FORM26_QUIRKS = {
  chainedCalcUsesFreshValue: true,
  deleteControlOnEveryRowTable: true,
  showAllSchedulesAffectsExport: false,
} as const;

/** The same switches with either setting (tests exercise both). */
export type Form26Quirks = { readonly [K in keyof typeof FORM26_QUIRKS]: boolean };
