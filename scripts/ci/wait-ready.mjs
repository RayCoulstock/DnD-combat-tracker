for (const url of ['http://localhost:3001/api/health','http://localhost:5173/']) {
  let ready=false
  for(let i=0;i<90;i++) {
    try {if((await fetch(url,{signal:AbortSignal.timeout(1000)})).ok){ready=true;break}} catch {/* bounded startup */}
    await new Promise(resolve=>setTimeout(resolve,1000))
  }
  if(!ready)throw Error('Local test service failed readiness; no external target was contacted.')
}
