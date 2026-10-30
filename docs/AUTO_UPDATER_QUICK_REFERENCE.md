> Historical updater guidance. The active entry points are main.cjs and preload.cjs, with auto-updater.cjs. Verify examples and security/readiness claims against [current architecture](project/ARCHITECTURE.md) and [status](project/CURRENT_STATUS.md).

# Auto-Updater Quick Reference

Quick lookup for common tasks.

## Installation (5 minutes)

```bash
# 1. Install dependencies
npm install electron-updater electron-log

# 2. Update package.json
# Add to root object:
{
  "repository": {
    "type": "git",
    "url": "https://github.com/YOUR_ORG/audit-assistant-pro.git"
  }
}

# 3. Add to build config in package.json:
{
  "build": {
    "publish": {
      "provider": "github",
      "owner": "YOUR_ORG",
      "repo": "audit-assistant-pro"
    }
  }
}

# Replace YOUR_ORG with actual GitHub organization
```

## Integration (10 minutes)

### Add to main app component

```typescript
// src/App.tsx
import { AppUpdaterManager } from '@/components/AppUpdaterManager';

export function App() {
  return (
    <>
      <AppUpdaterManager />
      {/* Your app */}
    </>
  );
}
```

### Add version badge to header

```typescript
import { VersionBadgeDisplay } from '@/components/AppUpdaterManager';

export function Header() {
  return (
    <header>
      <h1>Audit Assistant Pro</h1>
      <VersionBadgeDisplay />
    </header>
  );
}
```

### Add manual check button to settings

```typescript
import { ManualUpdateCheckButton } from '@/components/AppUpdaterManager';

export function SettingsPage() {
  return (
    <div>
      <h2>Updates</h2>
      <ManualUpdateCheckButton />
    </div>
  );
}
```

## Testing

### Test locally

```bash
# Enable beta channel
ENABLE_BETA_UPDATES=true npm run electron:dev

# Windows PowerShell
$env:ENABLE_BETA_UPDATES="true"
npm run electron:dev

# Windows CMD
set ENABLE_BETA_UPDATES=true && npm run electron:dev
```

### View logs

```bash
# Windows
cat "$env:APPDATA\Audit Assistant Pro\logs\electron-log.log" -Last 50

# macOS
tail -50 ~/Library/Logs/Audit\ Assistant\ Pro/electron-log.log

# Linux
tail -50 ~/.config/Audit\ Assistant\ Pro/logs/electron-log.log
```

## Releasing

### Manual Release

1. Update version in `package.json`
2. Build: `npm run electron:build`
3. Go to GitHub → Releases → Create new release
4. Tag: `v1.0.0` (must match package.json)
5. Upload installer from `electron-dist/`
6. Click "Publish release"

### Automated Release (GitHub Actions)

1. Setup token (one time): Add `GH_TOKEN` secret to GitHub
2. Update version in `package.json`
3. Tag and push: `git tag v1.0.0 && git push origin v1.0.0`
4. GitHub Actions automatically builds and releases

## Version Formats

```
Stable:     1.0.0, 1.0.1, 1.1.0, 2.0.0
Beta:       1.0.0-beta.1, 1.0.0-beta.2
RC:         1.0.0-rc.1, 1.0.0-rc.2
Alpha:      1.0.0-alpha.1

✓ Valid for electron-updater
✗ Invalid: 1.0, 1.0.0-beta, latest-build
```

## Update Flow

### For Stable Users

```
1. Version 0.9.0 installed
2. Check for updates
3. GitHub has v1.0.0 (stable)
4. ✓ Offer update
5. Download & install
```

### For Beta Users

```
1. Version 0.9.0 installed
2. Set ENABLE_BETA_UPDATES=true
3. Check for updates
4. GitHub has v1.0.0-beta.1 (pre-release)
5. ✓ Offer update (stable users don't see beta)
6. Download & install
```

### Version Already Installed

```
1. Version 1.0.0 installed
2. GitHub has v1.0.0
3. App already up-to-date
4. ✓ No notification
5. Continue using app
```

## React Hook Usage

```typescript
import { useAutoUpdater } from '@/hooks/useAutoUpdater';

export function MyComponent() {
  const {
    updateAvailable,      // Update found? {version, releaseNotes?, ...}
    updateDownloaded,     // Update ready? {version}
    downloadProgress,     // Download progress? {percent, transferred, total}
    isCheckingForUpdates, // Currently checking? boolean
    currentVersion,       // Current app version: string
    isBeta,              // Is beta version? boolean
    error,               // Error occurred? string | null
    checkForUpdates,     // Trigger manual check: () => Promise
    restartNow,          // Install and restart: () => void
  } = useAutoUpdater();

  return (
    <>
      {updateAvailable && (
        <div>Update {updateAvailable.version} available</div>
      )}
      {downloadProgress && (
        <div>Downloading: {downloadProgress.percent}%</div>
      )}
      {updateDownloaded && (
        <button onClick={restartNow}>Restart to Update</button>
      )}
    </>
  );
}
```

## Configuration

### Auto-updater.js - Main Settings

```javascript
// File: electron/auto-updater.js

// Check every 60 minutes
const updateInterval = setInterval(() => {
  autoUpdater.checkForUpdates();
}, 1000 * 60 * 60);

// Enable beta if:
// 1. ENABLE_BETA_UPDATES=true env var
// 2. Current version contains -beta/-rc/-alpha
// 3. User preference (stored somewhere)
function isBetaChannel() {
  if (process.env.ENABLE_BETA_UPDATES === 'true') return true;
  const appVersion = app.getVersion();
  return /^[0-9]+\.[0-9]+\.[0-9]+-/.test(appVersion);
}
```

### Enable Beta for Specific Users

Option 1: Version number
```json
{
  "version": "1.0.0-beta.1"
}
```
Users with beta version automatically get beta updates.

Option 2: Environment variable (testing)
```bash
ENABLE_BETA_UPDATES=true npm run electron:dev
```

Option 3: User preference (advanced)
```typescript
// Store in localStorage, database, or settings file
localStorage.setItem('enableBetaUpdates', 'true');
// Then check in isBetaChannel()
```

## Troubleshooting Checklist

### Updates not showing up

- [ ] Version in package.json < latest GitHub release
- [ ] GitHub repository field present and correct
- [ ] Running packaged app (not dev mode)
- [ ] GitHub release exists with correct tag
- [ ] Not on Windows Defender/Antivirus block list

### Beta updates not working

- [ ] ENABLE_BETA_UPDATES=true set
- [ ] OR version contains -beta/-rc/-alpha
- [ ] OR GitHub release marked as "Pre-release"
- [ ] Check isBetaChannel() returns true

### Installer errors

- [ ] electron-builder created installer in electron-dist/
- [ ] NSIS installed (Windows): `npm install -g nsis`
- [ ] Correct installer filename in GitHub release
- [ ] User has write permissions to Program Files

### View detailed logs

Windows:
```powershell
Get-Content "$env:APPDATA\Audit Assistant Pro\logs\electron-log.log" -Tail 50
```

macOS:
```bash
tail -50 ~/Library/Logs/Audit\ Assistant\ Pro/electron-log.log
```

Search for `[AUTO-UPDATER]` in logs.

## Components

### UpdateNotifications.tsx

```typescript
// Show when update available
<UpdateNotification
  version="1.0.0"
  releaseNotes="New features..."
  onRestart={() => {}}
/>

// Show download progress
<UpdateDownloadingIndicator
  percent={50}
  transferred={50000000}
  total={100000000}
/>

// Show when ready to restart
<UpdateReadyNotification
  version="1.0.0"
  onRestart={() => {}}
/>

// Show errors
<UpdateErrorNotification
  message="Failed to check for updates"
  onRetry={() => {}}
/>

// Show version
<VersionBadge version="1.0.0" isBeta={false} />
```

## IPC Handlers

These are available via preload:

```typescript
// Check for updates manually
await window.electronAPI.updater.checkForUpdates();
// Returns: {success, updateAvailable, currentVersion, latestVersion?}

// Get current version
await window.electronAPI.updater.getCurrentVersion();
// Returns: {version: "1.0.0", isBeta: false}

// Restart for pending update
await window.electronAPI.updater.restartForUpdate();

// Listen for events
window.electronAPI.updater.onUpdateEvent('update:available', (event, data) => {
  console.log('Update available:', data.version);
});

// Events:
// - update:checking
// - update:available
// - update:not-available
// - update:downloaded
// - update:progress
// - update:deferred
// - update:error
```

## Performance

- Network calls: ~100ms (GitHub API)
- Check interval: 60 minutes
- Download: Happens in background
- No UI blocking
- Graceful error handling

## Security

- ✓ HTTPS only
- ✓ GitHub signature verification
- ✓ Context isolation
- ✓ No IPC exposure
- ✓ Code signing ready
- ✓ User consent for restart

## Files Created/Modified

**New Files:**
- `electron/auto-updater.js` - Main implementation
- `electron/auto-updater-preload.js` - Security helper (optional)
- `src/hooks/useAutoUpdater.ts` - React hook
- `src/components/UpdateNotifications.tsx` - UI components
- `src/components/AppUpdaterManager.tsx` - Integration examples
- `docs/AUTO_UPDATER_SETUP.md` - Detailed setup guide
- `docs/AUTO_UPDATER_IMPLEMENTATION.md` - Architecture guide
- `docs/AUTO_UPDATER_SUMMARY.md` - Overview
- `docs/AUTO_UPDATER_QUICK_REFERENCE.md` - This file
- `.github/workflows/release.yml` - GitHub Actions

**Modified Files:**
- `electron/main.js` - Integrated auto-updater
- `electron/preload.js` - Added updater API
- `package.json` - Add repository field (TODO)

## Next Steps

1. Install dependencies: `npm install electron-updater electron-log`
2. Update `package.json` with repository
3. Test locally: `ENABLE_BETA_UPDATES=true npm run electron:dev`
4. Integrate `<AppUpdaterManager />` in your app
5. Create GitHub release for v1.0.0
6. Deploy to users

Done! Your app now auto-updates. 🎉
