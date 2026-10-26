import {createServer} from 'node:net'
import process from 'node:process'
import {pathToFileURL} from 'node:url'
export async function assertLocalPorts(ports=[3001,5173]) {
  const servers=[]
  try {
    for(const port of ports) {
      const server=createServer();servers.push(server)
      await new Promise((resolve,reject)=>{
        server.once('error',()=>reject(Error('Refusing tests: a required local port is occupied or unavailable.')))
        server.listen({port,host:'::',ipv6Only:false},resolve)
      })
    }
  } finally {
    await Promise.all(servers.map(server=>new Promise(resolve=>server.close(()=>resolve()))))
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await assertLocalPorts()
