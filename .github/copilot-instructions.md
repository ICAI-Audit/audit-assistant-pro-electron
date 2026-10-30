# ICAI VERA repository instructions

Read and follow [AGENTS.md](../AGENTS.md) before changing this repository.
At session start, read [project index](../docs/project/README.md), [product context](../docs/project/PRODUCT_CONTEXT.md), [current status](../docs/project/CURRENT_STATUS.md), [next tasks](../docs/project/NEXT_TASKS.md), and [latest handoff](../docs/project/SESSION_HANDOFF.md). State the selected task ID and validation approach. Read the relevant [project workflow](../docs/project/SKILLS_INDEX.md).

The active desktop entry points are electron/main.cjs and electron/preload.cjs. SQLite through Electron IPC is the active data path. Do not infer feature completeness from a screen or an old completion document. Preserve local client data, ledger signs, engagement isolation, and statutory version boundaries.

Before finishing, run npm run docs:check, update affected product and technical documentation, and record exact checks, remaining failures, and the next executable step in the latest handoff. Follow the shared instructions rather than maintaining a separate product specification here.
