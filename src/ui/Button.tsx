import {forwardRef,type ButtonHTMLAttributes} from 'react'
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {variant?:'secondary'|'primary'|'danger'|'ghost'}
export const Button=forwardRef<HTMLButtonElement,ButtonProps>(function Button({variant='secondary',type='button',className='',...props},ref){
 return <button {...props} ref={ref} type={type} className={`ledger-control ledger-button ledger-button--${variant} ${className}`}/>
})
