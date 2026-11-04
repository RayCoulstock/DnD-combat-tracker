import type {PoolClient} from 'pg'
import {ownedEntry} from './combatant-library.ts'
import {instantiateLibrary,type LibraryEntry} from '../shared/combatantLibrary.ts'
import {DomainError,type Actor,type EncounterState} from '../shared/domain.ts'
export function validateEntryCampaign(entry:LibraryEntry,campaignId:string){if(entry.kind!=='monster-template'&&entry.campaignId&&entry.campaignId!==campaignId)throw new DomainError('INVALID','This character belongs to another campaign.')}
export async function instantiateOwnedLibrary(db:PoolClient,actor:Actor,campaignId:string,state:EncounterState,entryId:string,instanceId:string,useSavedState:boolean,allowDuplicate:boolean,preloaded?:LibraryEntry){
 const entry=preloaded??await ownedEntry(db,actor,entryId);validateEntryCampaign(entry,campaignId)
 const saved=(await db.query('SELECT state FROM campaign_character_state WHERE campaign_id=$1 AND library_id=$2',[campaignId,entry.id])).rows[0]
 let instance=instantiateLibrary(entry,instanceId,state,useSavedState?saved?.state:undefined,allowDuplicate)
 const assetId=instance.miniature?.assetId,missingAsset=Boolean(assetId&&!(await db.query("SELECT 1 FROM assets_3d WHERE id=$1 AND owner_id=$2 AND upload_status='ready' FOR UPDATE",[assetId,actor.id])).rowCount)
 if(missingAsset)instance={...instance,miniature:{...instance.miniature!,assetId:null}}
 return {entry,instance,missingAsset}
}
