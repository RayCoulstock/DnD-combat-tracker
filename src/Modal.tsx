import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// The browser top layer owns stacking, focus containment and background inertness.
// Portal event guards keep dialog gestures from reaching map ancestors.
export default function Modal({ children, onClose, label, className = 'miniature-dialog', open = true }: { children: ReactNode; onClose: () => void; label: string; className?: string; open?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const dialog = ref.current!
    if (open) dialog.showModal()
    return () => dialog.close()
  }, [open])
  return createPortal(<dialog ref={ref} className={className} aria-label={label} aria-modal="true" onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose() }} onKeyDown={event => {
    if (event.key !== 'Tab' || (event.target as HTMLElement).closest('dialog[open]') !== event.currentTarget) return
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])')).filter(node => node.getClientRects().length && !node.closest('[inert]'))
    const first = controls[0], last = controls.at(-1)
    if (!first) { event.preventDefault(); event.currentTarget.focus() }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }} onClick={event => { event.stopPropagation(); if (className === 'modal-backdrop' && event.target === event.currentTarget) onClose() }} onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}>{children}</dialog>, document.body)
}
