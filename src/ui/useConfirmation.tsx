import {useEffect,useRef,useState} from 'react'
import Modal from '../Modal'
import {Button} from './Button'
export function useConfirmation(){
 const[prompt,setPrompt]=useState<{title:string;message:string;action:string}|null>(null),resolve=useRef<((value:boolean)=>void)|null>(null)
 useEffect(()=>()=>{resolve.current?.(false)},[])
 const finish=(value:boolean)=>{resolve.current?.(value);resolve.current=null;setPrompt(null)}
 const confirm=(title:string,message:string,action='Confirm')=>new Promise<boolean>(done=>{resolve.current?.(false);resolve.current=done;setPrompt({title,message,action})})
 const confirmation=prompt?<Modal className="ledger-confirmation" label={prompt.title} onClose={()=>finish(false)}><h2>{prompt.title}</h2><p>{prompt.message}</p><div className="ledger-actions"><Button autoFocus onClick={()=>finish(false)}>Cancel</Button><Button variant="danger" onClick={()=>finish(true)}>{prompt.action}</Button></div></Modal>:null
 return{confirm,confirmation}
}
