// Local registry for the FSG IPC handlers.
//
// The FSG handler modules (electron/fsg/ipc/*.js) were written against
// Electron's ipcMain and register channels such as 'tb:upload'. Inside VERA
// they import this registry instead, so that electron/fsg/index.js can expose
// every handler as `fsg:<channel>` behind VERA's authentication, trusted-frame
// and engagement-scope checks (electron/fsg/authorization.js). A handler is
// never reachable from the renderer without passing through that wrapper.

const handlers = new Map()

export const ipcMain = {
  handle(channel, handler) {
    if (typeof channel !== 'string' || !channel) throw new Error('FSG IPC channel name is required.')
    if (typeof handler !== 'function') throw new Error(`FSG IPC handler for ${channel} must be a function.`)
    if (handlers.has(channel)) throw new Error(`FSG IPC channel registered twice: ${channel}`)
    handlers.set(channel, handler)
  },
}

export function getRegisteredHandlers() {
  return handlers
}
