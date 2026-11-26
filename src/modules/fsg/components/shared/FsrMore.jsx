import React, { useEffect, useRef, useState } from 'react'
import { fsrPrefs, useFsrFocus, useFsrReportHeading } from '../../../../lib/fsrPrefs'

/**
 * "More" menu for a screen's toolbar (T-088, UI only).
 *
 * Holds the view options that do not belong on the toolbar itself: the full report heading on screen (off by default) and
 * Focus mode (hide the VERA sidebar and top bar). `children` are extra items a toolbar wants to tuck away when it is short of
 * room; they keep their own labels and handlers. Keyboard: Enter/Space/ArrowDown opens, arrows move, Home/End jump,
 * Escape closes and returns focus to the button.
 */
export default function FsrMore({ children, showViewOptions = true }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)
  const heading = useFsrReportHeading()
  const focus = useFsrFocus()

  const close = () => { setOpen(false); buttonRef.current?.focus() }
  const items = () => [...(menuRef.current?.querySelectorAll('[role^="menuitem"]:not(:disabled)') || [])]

  useEffect(() => { if (open) items()[0]?.focus() }, [open])

  const onMenuKeyDown = (e) => {
    const list = items()
    const i = list.indexOf(document.activeElement)
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus() }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus() }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus() }
    else if (e.key === 'Tab') { setOpen(false) }
  }

  return (
    <div className="relative" data-testid="fsr-more">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More: view options"
        onClick={() => setOpen(v => !v)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true) } }}
        className="border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
      >
        <span aria-hidden="true">⋯</span> More
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div ref={menuRef} role="menu" aria-label="More" onKeyDown={onMenuKeyDown}
            className="absolute right-0 top-full z-50 mt-1 min-w-[13rem] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
            {children}
            {showViewOptions && (
              <>
                <button role="menuitemcheckbox" aria-checked={heading} type="button"
                  onClick={() => fsrPrefs.setReportHeading(!heading)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs text-gray-800 hover:bg-gray-50">
                  <span>Report heading</span>
                  <span aria-hidden="true">{heading ? '✓' : ''}</span>
                </button>
                <button role="menuitemcheckbox" aria-checked={focus} type="button"
                  onClick={() => { fsrPrefs.setFocus(!focus); setOpen(false) }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs text-gray-800 hover:bg-gray-50">
                  <span>Focus mode <span className="text-gray-400">(Esc to exit)</span></span>
                  <span aria-hidden="true">{focus ? '✓' : ''}</span>
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
