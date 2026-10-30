> Historical updater guidance. The active entry points are main.cjs and preload.cjs, with auto-updater.cjs. Verify examples and security/readiness claims against [current architecture](project/ARCHITECTURE.md) and [status](project/CURRENT_STATUS.md).

# Auto-Updater Setup Guide

Complete setup for electron-updater with GitHub Releases provider.

## 1. Installation

Add `electron-updater` to your dependencies:

```bash
npm install electron-updater electron-log
# or
yarn add electron-updater electron-log
# or
pnpm add electron-updater electron-log
```

These are already used in your Electron setup, but ensure they're in `package.json`.

## 2. Package.json Configuration

Add repository information to `package.json` (required for GitHub provider auto-detection):

```json
{
  "name": "audit-assistant-pro",
  "version": "1.0.0",
  "repository": {
    "type": "git",
    "url": "https://github.com/YOUR_ORG/audit-assistant-pro.git"
  },
  "build": {
    "appId": "com.audit-assistant-pro.app",
    "productName": "Audit Assistant Pro",
    "directories": {
      "output": "electron-dist"
    },
    "files": [
      "dist/**/*",
      "electron/**/*",
      "public/**/*"
    ],
    "win": {
      "target": "nsis",
      "icon": "public/favicon.ico"
    },
    "publish": {
      "provider": "github",
      "owner": "YOUR_ORG",
      "repo": "audit-assistant-pro"
    }
  }
}
```

### Critical: Replace placeholders:
- `YOUR_ORG` - Your GitHub organization
- `audit-assistant-pro` - Your repository name

## 3. GitHub Setup

### 3.1 Create GitHub Releases

Create releases on GitHub with semantic versioning:

**Stable Releases:**
- Tag format: `v1.0.0`, `v1.0.1`, etc.
- Release name: `Audit Assistant Pro 1.0.0`
- Include Windows installer: `Audit Assistant Pro 1.0.0.exe` or NSIS installer

**Beta/Pre-release Releases:**
- Tag format: `v1.0.0-beta.1`, `v1.0.0-rc.1`, etc.
- Mark as "Pre-release" checkbox in GitHub UI ✓
- Release name: `Audit Assistant Pro 1.0.0-beta.1`
- Same installer attached

### 3.2 GitHub Token (for CI/CD releases)

If using GitHub Actions to publish releases:

1. Create a Personal Access Token (PAT):
   - Go to GitHub Settings → Developer settings → Personal access tokens
   - Create token with `repo` scope (for public repos, `public_repo` is enough)
   - Copy token value

2. Add to GitHub Actions secrets:
   - Go to repository Settings → Secrets and variables → Actions
   - Add secret: `GH_TOKEN` = your PAT value

3. Use in electron-builder publish (`.github/workflows/release.yml`):
   ```yaml
   - name: Build and publish
     env:
       GH_TOKEN: ${{ secrets.GH_TOKEN }}
     run: npm run electron:build
   ```

## 4. Code Implementation

### 4.1 Main Process Setup

In `electron/main.js`:

```javascript
const { initializeAutoUpdater } = require('./auto-updater');

app.whenReady().then(() => {
  setupGstzenHandlers();
  setupAppHandlers();
  createWindow();
  
  // Initialize auto-updater
  initializeAutoUpdater();
  
  // ...
});
```

### 4.2 Preload Script

In `electron/preload.js`:

```javascript
// Auto-updater methods exposed to renderer
updater: {
  checkForUpdates: () => ipcRenderer.invoke('updater:checkForUpdates'),
  getCurrentVersion: () => ipcRenderer.invoke('updater:getCurrentVersion'),
  restartForUpdate: () => ipcRenderer.invoke('updater:restartForUpdate'),
  onUpdateEvent: (channel, listener) => ipcRenderer.on(channel, listener),
  removeUpdateListener: (channel, listener) => ipcRenderer.removeListener(channel, listener),
}
```

### 4.3 React Component Usage

Use the provided hook in your React components:

```typescript
import { useAutoUpdater } from '@/hooks/useAutoUpdater';

export function AppHeader() {
  const { 
    updateAvailable, 
    downloadProgress, 
    restartNow,
    currentVersion,
    isBeta 
  } = useAutoUpdater();

  return (
    <div>
      {/* Show version badge */}
      <div className="text-sm text-gray-500">
        v{currentVersion} {isBeta && <span className="text-orange-500">(beta)</span>}
      </div>

      {/* Show update notification */}
      {updateAvailable && (
        <UpdateNotification 
          version={updateAvailable.version} 
          onRestart={restartNow}
        />
      )}

      {/* Show download progress */}
      {downloadProgress && (
        <ProgressBar percent={downloadProgress.percent} />
      )}
    </div>
  );
}
```

## 5. Beta Channel Management

### Method 1: Environment Variable

For testing beta updates locally:

```bash
# Windows PowerShell
$env:ENABLE_BETA_UPDATES="true"
npm run electron:dev

# Windows CMD
set ENABLE_BETA_UPDATES=true
npm run electron:dev

# macOS/Linux
ENABLE_BETA_UPDATES=true npm run electron:dev
```

### Method 2: Current Version

If app version contains `-beta`, `-alpha`, or `-rc`:
- Version `1.0.0-beta.1` automatically receives beta updates
- Beta users can test new features before stable release
- Stable users stay on stable releases

### Method 3: User Preference (Advanced)

Store user's channel preference:

```typescript
// In React component
const setBetaChannel = async (enabled: boolean) => {
  // Save to user preferences (localStorage, database, etc.)
  localStorage.setItem('enableBetaUpdates', enabled.toString());
  
  // Tell main process
  // (You'd need to add an IPC handler for this)
};
```

Then in `electron/auto-updater.js`, check user preferences:

```javascript
function isBetaChannel() {
  if (process.env.ENABLE_BETA_UPDATES === 'true') return true;
  
  const appVersion = app.getVersion();
  const isCurrentBeta = /^[0-9]+\.[0-9]+\.[0-9]+-/.test(appVersion);
  if (isCurrentBeta) return true;
  
  // Add: Check user preference from persistent storage
  return false;
}
```

## 6. Semantic Versioning

Follow semantic versioning for releases:

```
MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]

Examples:
1.0.0           - First stable release
1.0.1           - Patch release (bug fix)
1.1.0           - Minor release (new feature)
2.0.0           - Major release (breaking change)

1.0.0-alpha.1   - First alpha (very early)
1.0.0-beta.1    - First beta (feature complete, testing)
1.0.0-rc.1      - Release candidate (near stable)
```

**Key Rules:**
- Beta versions: only users with `allowPrerelease=true` receive these
- Stable versions: all users receive these
- Always increment consistently

## 7. Windows NSIS Installer

electron-builder automatically creates NSIS installers for Windows.

### 7.1 Installer Features

The generated installer includes:
- Auto-update capability ✓
- Add/Remove Programs entry ✓
- Desktop shortcut (optional) ✓
- Start menu shortcut ✓
- 64-bit support ✓

### 7.2 Custom Installer (Optional)

In `package.json`:

```json
"nsis": {
  "oneClick": false,
  "allowToChangeInstallationDirectory": true,
  "createDesktopShortcut": true,
  "createStartMenuShortcut": true,
  "shortcutName": "Audit Assistant Pro"
}
```

## 8. Logging

Auto-updater logs are written to:

**Windows:**
```
%APPDATA%\Audit Assistant Pro\logs\
```

**macOS:**
```
~/Library/Logs/Audit Assistant Pro/
```

**Linux:**
```
~/.config/Audit Assistant Pro/logs/
```

Log file: `electron-log.log`

View logs in development:
```javascript
// In React component
const getLogs = async () => {
  const logsPath = app.getPath('logs');
  // Read electron-log.log from this path
};
```

## 9. Build and Release Workflow

### 9.1 Local Build

```bash
# Build app
npm run electron:build

# This creates:
# - electron-dist/Audit Assistant Pro 1.0.0.exe (Windows)
# - electron-dist/Audit Assistant Pro 1.0.0.dmg (macOS)
```

### 9.2 Manual Release to GitHub

1. Go to GitHub repository → Releases
2. Click "Create a new release"
3. Tag: `v1.0.0` (must match package.json version)
4. Release title: `Audit Assistant Pro 1.0.0`
5. Attach built installers:
   - Windows: `electron-dist/Audit Assistant Pro 1.0.0.exe`
   - macOS: `electron-dist/Audit Assistant Pro 1.0.0.dmg`
6. Click "Publish release"

### 9.3 Automated Release (GitHub Actions)

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v3
      
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      
      - run: npm ci
      
      - run: npm run build
      
      - name: Build Electron
        env:
          GH_TOKEN: ${{ secrets.GH_TOKEN }}
        run: npm run electron:build
```

## 10. Testing Updates

### 10.1 Test in Development

```bash
# Build production bundle
npm run build

# Build and run Electron app with auto-updater
npm run electron
```

### 10.2 Test Beta Updates

```bash
# Build with beta version in package.json
# Change version to "1.0.0-beta.1"
npm run build
npm run electron:build

# Create beta release on GitHub
# App will automatically check and update to beta
```

### 10.3 Disable Auto-Updates in Dev

The auto-updater automatically disables itself in development mode:

```javascript
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
```

Updates only work when app is packaged (production build).

## 11. Troubleshooting

### Update not detected

1. Check GitHub releases exist with proper tags
2. Verify version in `package.json` (must be < release version)
3. Check logs: `%APPDATA%\Audit Assistant Pro\logs\electron-log.log`
4. Ensure `repository` field in `package.json` is correct

### Beta updates not received

1. Verify release is marked as "Pre-release" on GitHub
2. Check `isBetaChannel()` returns `true`
3. Set `ENABLE_BETA_UPDATES=true` for testing

### Installer not found

1. Ensure electron-builder created it:
   ```bash
   ls electron-dist/
   ```
2. Filename must match GitHub release asset name exactly
3. Build with `npm run electron:build`

### Updates fail with network error

1. Check internet connectivity
2. Verify GitHub is accessible
3. Check GitHub API rate limiting
4. Check app has network permissions

### Windows NSIS issues

1. Ensure NSIS is installed for building (electron-builder requirement)
2. Check installer was created in `electron-dist/`
3. Verify Windows defender doesn't block installer

## 12. Best Practices

1. **Always use semantic versioning** - Prevents confusion
2. **Test beta releases first** - Before promoting to stable
3. **Include release notes** - Users appreciate change information
4. **Don't force restarts** - Let users choose "Later"
5. **Log everything** - Helps diagnose production issues
6. **Set pre-release=false for stable** - Only intentional beta updates
7. **Monitor update adoption** - Track which versions users run
8. **Plan downtime** - If using version-specific APIs, support 2+ versions

## 13. Files Summary

### Created/Modified:

- `electron/auto-updater.js` - Main auto-updater implementation
- `electron/auto-updater-preload.js` - Preload helpers (optional)
- `electron/main.js` - Modified to use new auto-updater
- `electron/preload.js` - Added updater API exposure
- `src/hooks/useAutoUpdater.ts` - React hook for components

### Configuration files to update:

- `package.json` - Add `repository` field and dependencies

## 14. Next Steps

1. ✅ Update `package.json` with GitHub repository info
2. ✅ Install dependencies: `npm install electron-updater electron-log`
3. ✅ Test locally with beta flag: `ENABLE_BETA_UPDATES=true npm run electron:dev`
4. ✅ Build and create first GitHub release
5. ✅ Deploy to users and monitor logs
6. ✅ Use `useAutoUpdater()` hook in your UI components
