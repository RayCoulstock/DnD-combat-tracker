// Run read-only inside the application container after a restore. Prints counts only.
import pg from 'pg'
import {createReadStream} from 'node:fs'
import {lstat,realpath} from 'node:fs/promises'
import {resolve,dirname,sep} from 'node:path'
import {createHash} from 'node:crypto'
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000})
try{
 if(!process.env.DATABASE_URL||!process.env.ASSET_STORAGE_DIR)throw Error('Missing audit configuration')
 const root=await realpath(process.env.ASSET_STORAGE_DIR)
 const rows=(await pool.query("SELECT storage_key,content_hash,file_size FROM assets_3d WHERE upload_status='ready'")).rows
 let failures=0
 for(const row of rows){
  try{
   if(!/^[a-f0-9-]{36}\/[a-f0-9]{64}\.glb$/.test(row.storage_key))throw Error('Invalid key')
   const path=resolve(root,row.storage_key),info=await lstat(path)
   if(!path.startsWith(root+sep)||await realpath(dirname(path))!==dirname(path)||info.isSymbolicLink()||!info.isFile()||info.size!==Number(row.file_size))throw Error('Invalid file')
   const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk)
   if(hash.digest('hex')!==row.content_hash)throw Error('Hash mismatch')
  }catch{failures++}
 }
 console.log(`Ready GLB audit: ${rows.length-failures}/${rows.length} valid`)
 if(failures)process.exitCode=1
}catch{console.error('Asset audit failed. Check database/storage availability and restored data integrity.');process.exitCode=1}
finally{await pool.end()}
