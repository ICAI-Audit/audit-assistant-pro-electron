// Central build message. The login page and the application header both render
// this text through BuildInfoLabel, so edit it here only. Change updateNote for
// each accepted merge (for example "GSTIN validation added") and set sourceBranch
// when the build comes from a named branch.
export const BUILD_MESSAGE = {
  lines: [
    'Welcome to ICAI Audit Tool',
    'Repository sync: origin/main (13 November 2026)',
  ],
  updateNote: 'CAAT Tools (PR #109) + FSG/RSF updates (PR #110)',
  sourceBranch: 'main' as string,
};

// Static build facts only. The commit and the local-changes flag are fixed at build
// time by vite.config.ts; nothing here checks GitHub or whether the code is current.
export function buildDetailLines(): string[] {
  return [
    ...(BUILD_MESSAGE.sourceBranch ? [`Source branch: ${BUILD_MESSAGE.sourceBranch}`] : []),
    `Commit: ${__BUILD_COMMIT__}`,
    ...(__BUILD_DIRTY__ ? ['Local changes present'] : []),
  ];
}
