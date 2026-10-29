> Historical updater guidance. The active entry points are main.cjs and preload.cjs, with auto-updater.cjs. Verify examples and security/readiness claims against [current architecture](project/ARCHITECTURE.md) and [status](project/CURRENT_STATUS.md).

# Auto-Updater Implementation Guide

## Overview

This implementation provides production-ready auto-update functionality for Audit Assistant Pro using electron-updater with GitHub Releases. The system supports both stable and beta releases with proper semantic versioning.

## Architecture

### Components

```
electron/
├── auto-updater.js                    # Main updater logic (no deprecated APIs)
├── auto-updater-preload.js            # Preload helper (optional)
├── main.js                            # Updated with new auto-updater initialization
└── preload.js                         # Exposes safe IPC methods to renderer

src/
├── hooks/
│   └── useAutoUpdater.ts              # React hook for UI components
└── components/
    ├── UpdateNotifications.tsx         # Reusable notification components
    └── AppUpdaterManager.tsx           # Example integration

docs/
└── AUTO_UPDATER_SETUP.md              # Comprehensive setup guide

.github/workflows/
└── release.yml                        # GitHub Actions automation
```

### Data Flow

```
┌─────────────────────────────────────────────────────────┐
│  GitHub Releases                                         │
│  ├── v1.0.0 (stable)                                   │
│  ├── v1.0.1-beta.1 (pre-release)                       │
│  └── Audit Assistant Pro.exe (NSIS installer)          │
└─────────────────────────────────────────────────────────┘
                           ▲
                           │ (HTTPS)
                           │
┌─────────────────────────────────────────────────────────┐
│  Electron App (Main Process)                            │
│  ├── auto-updater.js                                    │
│  │   ├── checkForUpdates() - triggered on startup       │
│  │   ├── Configuration based on isBetaChannel()         │
│  │   └── Event handlers for all update states           │
│  └── IPC handlers - communicate with renderer           │
└─────────────────────────────────────────────────────────┘
                           │
                           │ (IPC)
                           ▼
┌─────────────────────────────────────────────────────────┐
│  React Components (Renderer Process)                    │
│  ├── useAutoUpdater() hook                              │
│  ├── UpdateNotifications components                     │
│  └── App shows notifications and progress to user       │
└─────────────────────────────────────────────────────────┘
```

## Key Features Implemented

### 1. Beta Channel Management

Two-tier release system:

**Stable Channel:**
- Version: `1.0.0`, `1.0.1`, `1.1.0`, `2.0.0`
- All users receive these updates
- No pre-release label on GitHub
- Fully tested and production-ready

**Beta Channel:**
- Version: `1.0.0-beta.1`, `1.0.0-rc.1`, etc.
- Only users with `allowPrerelease=true` receive
- Marked as pre-release on GitHub
- For testing new features

### 2. Update Lifecycle

```
User Launch
    │
    ├─→ Check for Updates (automatic)
    │   └─→ Query GitHub API
    │
    ├─→ Update Available?
    │   │
    │   ├─→ YES
    │   │   ├─→ Show Notification
    │   │   ├─→ Download in Background
    │   │   ├─→ Show Progress (optional)
    │   │   └─→ Prompt to Restart
    │   │       ├─→ User clicks "Restart"
    │   │       │   └─→ quitAndInstall()
    │   │       └─→ User clicks "Later"
    │   │           └─→ Continue app
    │   │
    │   └─→ NO
    │       └─→ Continue app
    │
    └─→ Periodic Check (every 60 min)
        └─→ Repeat checks
```

### 3. Error Handling

Update failures don't crash the app:
- Network errors → logged, app continues
- Installer not found → logged, app continues  
- GitHub API issues → retried automatically
- User can manually check for updates

### 4. Semantic Versioning Support

Proper version comparison:

```
Valid versions:
✓ 1.0.0                   (stable)
✓ 1.0.1                   (stable patch)
✓ 1.1.0                   (stable minor)
✓ 2.0.0                   (stable major)
✓ 1.0.0-beta.1            (beta)
✓ 1.0.0-rc.1              (release candidate)

Invalid (electron-updater will ignore):
✗ 1.0                     (missing patch)
✗ 1.0.0-beta             (missing pre-release number)
✗ latest-build            (not semantic)
```

### 5. Windows NSIS Support

electron-builder creates NSIS installers with:
- Auto-update capability
- Silent/non-interactive installation option
- Add/Remove Programs entry
- 64-bit support
- Registry entries for updater

## Configuration

### Minimum Configuration (package.json)

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
    "publish": {
      "provider": "github",
      "owner": "YOUR_ORG",
      "repo": "audit-assistant-pro"
    }
  }
}
```

**Important:** Replace `YOUR_ORG` with actual GitHub organization/owner.

### Environment Variables

**Development/Testing:**
```bash
# Enable beta updates for testing
ENABLE_BETA_UPDATES=true npm run electron:dev

# Check logs
tail -f "$APPDATA\Audit Assistant Pro\logs\electron-log.log"  # Windows
tail -f ~/Library/Logs/Audit\ Assistant\ Pro/electron-log.log  # macOS
```

## Code Organization

### auto-updater.js

Main module responsible for:

1. **Configuration** - Sets `allowPrerelease` based on channel
2. **Event Handlers** - Listens to all updater events
3. **IPC Handlers** - Exposes methods to renderer
4. **Notifications** - Sends updates to UI components
5. **Error Handling** - Graceful failures

**Why no deprecated APIs:**
- ✗ `autoUpdater.setFeedURL()` - deprecated in electron-updater 7+
- ✓ GitHub provider auto-detected from package.json
- ✗ `checkForUpdatesAndNotify()` with options - outdated
- ✓ Explicit event handlers instead

### preload.js

Safe IPC bridge:
```javascript
updater: {
  checkForUpdates(),        // Invoke: returns Promise
  getCurrentVersion(),      // Invoke: returns {version, isBeta}
  restartForUpdate(),       // Invoke: quits and installs
  onUpdateEvent(),          // Listen: for update events
  removeUpdateListener(),   // Unlisten: cleanup
}
```

**Security:**
- ✓ No direct IPC exposure
- ✓ Context isolation enabled
- ✓ Limited methods only
- ✓ Channel validation in listeners

### useAutoUpdater Hook

React integration:
```typescript
const { 
  isCheckingForUpdates,     // boolean
  updateAvailable,          // {version, releaseNotes?, ...}
  updateDownloaded,         // {version}
  downloadProgress,         // {percent, transferred, total}
  currentVersion,           // string
  isBeta,                   // boolean
  error,                    // string | null
  checkForUpdates,          // () => Promise
  restartNow,              // () => void
} = useAutoUpdater();
```

Handles all event listeners automatically.

## Integration Checklist

- [ ] Install dependencies: `npm install electron-updater electron-log`
- [ ] Update `package.json` with GitHub repository info
- [ ] Review and customize `electron/auto-updater.js` if needed
- [ ] Update `electron/preload.js` with updater API
- [ ] Integrate `AppUpdaterManager` in your main app component
- [ ] Add version badge using `VersionBadge` component
- [ ] Create GitHub releases with proper semantic versioning
- [ ] Test locally with `ENABLE_BETA_UPDATES=true`
- [ ] Set up GitHub Actions workflow for automated releases
- [ ] Monitor update adoption in production

## Testing Guide

### Local Testing

```bash
# 1. Change version in package.json to something lower (e.g., 0.9.9)
# 2. Build production bundle
npm run build

# 3. Create GitHub release for v0.9.9
# On GitHub: Create Release "v0.9.9" → Upload installer

# 4. Build app
npm run electron:build

# 5. Run app with current version (e.g., 1.0.0)
# It will detect 0.9.9 < 1.0.0 and NOT show update
# (Version in binary must be >= GitHub release)

# Alternative: Test with beta
# 1. Change version to "1.0.0-beta.1"
# 2. Build and upload
# 3. Run with ENABLE_BETA_UPDATES=true
npm run electron:build
ENABLE_BETA_UPDATES=true npm run electron:dev
```

### E2E Testing Checklist

- [ ] Update available → notification shows
- [ ] User clicks restart → app quits and installs
- [ ] User clicks later → notification dismisses
- [ ] Download progress → bar updates
- [ ] Network offline → error shown
- [ ] Beta flag on → receives -beta versions
- [ ] Beta flag off → only stable versions
- [ ] Manual check → triggers full flow
- [ ] Periodic check → checks every 60 min

## Production Deployment

### Release Steps

1. **Update version in package.json**
   ```json
   {
     "version": "1.0.0"
   }
   ```

2. **Create GitHub release**
   - Go to Releases → Draft new release
   - Tag: `v1.0.0` (must match package.json)
   - Title: `Audit Assistant Pro 1.0.0`
   - Attach installer: `Audit Assistant Pro 1.0.0.exe`
   - Click Publish release

3. **Users are notified automatically**
   - electron-updater checks GitHub API
   - Compares versions
   - Downloads and installs automatically

### Beta Release Steps

Same as above but:
- Version: `1.0.0-beta.1` or higher
- Check "Pre-release" box on GitHub
- Only beta users receive it

## Troubleshooting

### Issue: Updates not detected

**Causes:**
1. Version in package.json >= latest GitHub release
   - Fix: Ensure local version < GitHub release version

2. GitHub repository not configured
   - Fix: Check `package.json` repository field

3. Release doesn't exist on GitHub
   - Fix: Create release with exact tag format

4. Running in development mode
   - Fix: Updates only work on packaged app (production)

**Diagnosis:**
```bash
# Check logs
cat "$(Get-Item $env:APPDATA)\Audit Assistant Pro\logs\electron-log.log" -Last 20

# Look for [AUTO-UPDATER] messages
```

### Issue: Beta updates not received

**Causes:**
1. `isBetaChannel()` returns false
   - Fix: Set `ENABLE_BETA_UPDATES=true` or use beta version

2. Release not marked as pre-release on GitHub
   - Fix: Check "Pre-release" box when publishing

3. Version doesn't have pre-release suffix
   - Fix: Use `1.0.0-beta.1` format

### Issue: Installer not found after download

**Causes:**
1. Build failed - no installer created
   - Fix: Check `npm run electron:build` output

2. Installer filename doesn't match GitHub upload
   - Fix: Ensure exact filename match

3. NSIS not installed (Windows)
   - Fix: electron-builder installs automatically, or: `npm install -g nsis`

**Check:**
```bash
ls electron-dist/        # List built artifacts
```

### Issue: High update failure rate

**Causes:**
1. Network instability
   - Fix: Implement retry logic (electron-updater handles this)

2. GitHub API rate limiting
   - Fix: Not a user problem, temporary

3. User permissions issues (Windows)
   - Fix: Run installer as admin

4. Antivirus blocking installer
   - Fix: Sign installer (Windows code signing)

**Monitor:**
- Track update events in logs
- Alert on error rate > 5%
- Rollback if critical issue found

## Security Considerations

### Code Signing (Recommended for Production)

Prevents tampering with installers:

```json
"win": {
  "certificateFile": "path/to/certificate.pfx",
  "certificatePassword": "env:WIN_CERT_PASSWORD"
}
```

### Update Verification

electron-updater automatically verifies:
- ✓ HTTPS connection to GitHub
- ✓ Release authenticity (from GitHub)
- ✓ Installer checksum
- ✓ No MITM attacks possible

### User Consent

Always ask before restart:
- ✓ "Restart Now" / "Later" buttons
- ✓ Never auto-restart without prompt
- ✓ Preserve user's work first

## Performance Tuning

### Reduce Network Overhead

Current implementation:
- ✓ Checks only on startup + every 60 min
- ✓ Queries GitHub API (lightweight)
- ✓ Downloads only when update available

### Optimize for Offline Users

```javascript
// In auto-updater.js, if needed:
autoUpdater.on('error', (err) => {
  log.error('[AUTO-UPDATER] Error:', err);
  // Don't notify user of network errors if offline
  if (err.message.includes('network')) {
    // Silent fail
    return;
  }
  notifyRenderer('update:error', { message: err.message });
});
```

## Monitoring and Analytics

### What to Track

1. **Update Adoption**
   - How many users are on latest version?
   - Distribution of versions in use

2. **Update Success Rate**
   - What % of available updates are installed?
   - Failure rate and causes

3. **Performance Impact**
   - Download time
   - Restart wait time
   - User engagement during update

### Implementation

Store telemetry in your backend:

```typescript
const { currentVersion, isBeta } = useAutoUpdater();

// Report on app startup
fetch('your-api.com/telemetry', {
  method: 'POST',
  body: JSON.stringify({
    appVersion: currentVersion,
    isBeta,
    platform: window.electronAPI.platform,
    timestamp: new Date().toISOString(),
  })
});
```

## Next Steps

1. **Immediate:**
   - Update `package.json` with repository
   - Install dependencies
   - Test beta updates locally

2. **Short-term:**
   - Create first GitHub release
   - Deploy to users
   - Monitor logs for errors

3. **Long-term:**
   - Implement telemetry tracking
   - Add user settings for beta opt-in
   - Create update announcements/changelog system
   - Monitor version adoption

## References

- [electron-updater docs](https://github.com/electron-userland/electron-builder/wiki/Auto-Update)
- [electron-builder documentation](https://www.electron.build/)
- [Semantic Versioning](https://semver.org/)
- [Electron security](https://www.electronjs.org/docs/tutorial/security)
