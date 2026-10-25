import {transaction,type Pool} from './db.ts'
import type {TacticalRecord} from '../shared/tactical.ts'
export async function expireMeasurements(pool:Pool,now=Date.now()){
 const candidates=(await pool.query(`SELECT id,campaign_id FROM encounters WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(state->'tactical','[]'::jsonb)) r WHERE r->>'kind'='measurement' AND (r->>'expiresAt')::double precision<=$1)`,[now])).rows
 const campaigns=new Set<string>()
 for(const candidate of candidates)await transaction(pool,async db=>{
  await db.query('SELECT id FROM campaigns WHERE id=$1 FOR UPDATE',[candidate.campaign_id])
  const row=(await db.query('SELECT state FROM encounters WHERE id=$1 FOR UPDATE',[candidate.id])).rows[0]
  if(!row)return
  const records:TacticalRecord[]=row.state.tactical??[],next=records.filter(r=>r.kind!=='measurement'||(r.expiresAt??0)>now)
  if(next.length===records.length)return
  await db.query('UPDATE encounters SET state=$2,revision=revision+1,updated_at=now() WHERE id=$1',[candidate.id,{...row.state,tactical:next}])
  await db.query('UPDATE campaigns SET state_revision=state_revision+1 WHERE id=$1',[candidate.campaign_id]);campaigns.add(candidate.campaign_id)
 })
 return campaigns
}
