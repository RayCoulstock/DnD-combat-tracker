export function StatusPill({children,tone='neutral',announce=false}:{children:string;tone?:'neutral'|'success'|'warning'|'danger'|'party';announce?:boolean}){
 return <span className={`ledger-control ledger-status-pill ledger-status-pill--${tone}`} role={announce?'status':undefined} aria-atomic={announce?true:undefined}>{children}</span>
}
