import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execFileSync } from "node:child_process";
import { componentTagger } from "lovable-tagger";

// Vite plugin to exclude SQLite from bundling
function excludeSQLite() {
  return {
    name: 'exclude-sqlite',
    resolveId(id: string) {
      // Exclude sqlite directory and Node.js modules
      if (id.includes('sqlite/database-manager') || 
          id.includes('sqlite/access-control') ||
          id === 'better-sqlite3' ||
          id === 'bcrypt' ||
          id === 'fs' ||
          id === 'path' ||
          id === 'crypto') {
        return { id, external: true };
      }
    },
    load(id: string) {
      // Return empty module for excluded files
      if (id.includes('sqlite/database-manager') || 
          id.includes('sqlite/access-control')) {
        return 'export default {};';
      }
    }
  };
}

// xlsx-js-style (used by Financial Statement Review exports) ships only a
// CommonJS build that calls require('fs') for its desktop file helpers. The
// renderer never uses them (workbooks are written to a buffer and saved
// through IPC), and the package's own "browser" field maps fs to nothing.
// Give it an empty module so no bare `import "fs"` reaches the renderer.
const EMPTY_FS_ID = '\0xlsx-js-style-empty-fs';
const isXlsxJsStyle = (importer?: string) => Boolean(importer && /[\\/]xlsx-js-style[\\/]/.test(importer));

function xlsxJsStyleWithoutFs() {
  return {
    name: 'xlsx-js-style-without-fs',
    enforce: 'pre' as const,
    resolveId(id: string, importer?: string) {
      if (id === 'fs' && isXlsxJsStyle(importer)) return EMPTY_FS_ID;
      return null;
    },
    load(id: string) {
      if (id === EMPTY_FS_ID) return 'export default {};';
      return null;
    },
  };
}

// Short commit and local-changes flag shown by BuildInfoLabel. Falls back to
// "unknown" when git is unavailable (for example a source archive).
function readBuildInfo() {
  const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const commit = git(['rev-parse', '--short', 'HEAD']);
    const dirty = git(['status', '--porcelain', '--untracked-files=no']).length > 0;
    return { commit, dirty };
  } catch {
    return { commit: 'unknown', dirty: false };
  }
}
const buildInfo = readBuildInfo();

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: mode === "development" ? "/" : "./",
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildInfo.commit),
    __BUILD_DIRTY__: JSON.stringify(buildInfo.dirty),
  },
  server: {
    host: "::",
    port: 8080,
    proxy: {
      "^/(api|accounts)": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      }
    },
  },
  plugins: [
    xlsxJsStyleWithoutFs(),
    react(),
    mode === "development" && componentTagger(),
    excludeSQLite()
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      external: (id, importer) => {
        // Mark Node.js modules and sqlite directory as external
        // (except fs inside xlsx-js-style: see xlsxJsStyleWithoutFs)
        return id === 'better-sqlite3' ||
               id === 'bcrypt' ||
               (id === 'fs' && !isXlsxJsStyle(importer)) ||
               id === 'path' ||
               id === 'crypto' ||
               id.includes('sqlite/database-manager') ||
               id.includes('sqlite/access-control') ||
               id.startsWith('@mapbox/node-pre-gyp') ||
               id === 'mock-aws-s3' ||
               id === 'aws-sdk' ||
               id === 'nock';
      },
    },
  },
  optimizeDeps: {
    exclude: [
      'better-sqlite3',
      'bcrypt',
      'mock-aws-s3',
      'aws-sdk',
      'nock',
    ],
  },
}));
