import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// The browser top layer owns stacking, focus containment and background inertness.
// Portal event guards keep dialog gestures from reaching map ancestors.
export default function Modal({ children, onClose, label, className = 'miniature-dialog' }: { children: ReactNode; onClose: () => void; label: string; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return createPortal(<dialog ref={ref} className={className} aria-label={label} aria-modal="true" onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { event.stopPropagation(); if (className === 'modal-backdrop' && event.target === event.currentTarget) onClose() }} onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}>{children}</dialog>, document.body)
}
