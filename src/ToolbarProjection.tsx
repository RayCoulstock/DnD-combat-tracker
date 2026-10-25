import {useFrame,useThree} from '@react-three/fiber'
import {Vector3} from 'three'
import {useEffect,type RefObject} from 'react'
export default function ToolbarProjection({target,position}:{target:RefObject<HTMLDivElement|null>;position:[number,number,number]}){
 const invalidate=useThree(s=>s.invalidate)
 useEffect(()=>{const update=()=>invalidate();window.addEventListener('scroll',update,true);window.addEventListener('resize',update);return()=>{window.removeEventListener('scroll',update,true);window.removeEventListener('resize',update)}},[invalidate])
 useFrame(({camera,gl})=>{
  const node=target.current;if(!node)return
  const point=new Vector3(...position).project(camera),canvas=gl.domElement.getBoundingClientRect()
  const left=Math.max(8,canvas.left),right=Math.min(window.innerWidth-8,canvas.right),top=Math.max(8,canvas.top),bottom=Math.min(window.innerHeight-8,canvas.bottom)
  if(point.z>1||point.z< -1||right<=left||bottom<=top){node.setAttribute('hidden','');return}
  node.removeAttribute('hidden');const w=node.offsetWidth,h=node.offsetHeight
  node.style.setProperty('left',`${Math.max(8,Math.min(right-w,Math.max(left,canvas.left+(point.x+1)*canvas.width/2-w/2)))}px`)
  node.style.setProperty('top',`${Math.max(8,Math.min(bottom-h,Math.max(top,canvas.top+(1-point.y)*canvas.height/2-h-16)))}px`)
 })
 return null
}
