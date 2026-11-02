// File-system locations used by the FSG module inside ICAI VERA.
//
// Bundled reference files (Mapping_v2.xlsx, itr-templates/, the prescribed
// format reference) live in electron/fsg/assets/ and ship inside the app with
// the rest of electron/**. Per-user files (Tally connection settings, Tally
// debug dumps) live under <userData>/fsg/ next to VERA's audit_assistant.db.

import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export function assetPath(...segments) {
  return join(here, 'assets', ...segments)
}

export function userDataPath(...segments) {
  const base = join(app.getPath('userData'), 'fsg')
  if (!existsSync(base)) mkdirSync(base, { recursive: true })
  return join(base, ...segments)
}
