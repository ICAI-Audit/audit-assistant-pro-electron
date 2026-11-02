// Container for menus and dialogs that the Financial Statement Review screens
// render through React portals. FSG_Bharat portalled them into <body>; inside
// ICAI VERA they go into this element instead, so that they still carry the
// module's scoped styles and theme (.fsg-root, data-theme) without those
// styles applying to the rest of VERA.

const PORTAL_ID = 'fsg-portal-root'

export function getPortalRoot() {
  let el = document.getElementById(PORTAL_ID)
  if (!el) {
    el = document.createElement('div')
    el.id = PORTAL_ID
    el.className = 'fsg-root fsg-portal-root'
    document.body.appendChild(el)
  }
  return el
}
