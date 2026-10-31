// Legacy name retained for existing tool guards. Transient foundation surfaces
// also own keyboard interaction while open, without becoming modal dialogs.
export function isModalOpen() { return Boolean(document.querySelector('dialog[open], [data-ledger-overlay-open="true"]')) }
