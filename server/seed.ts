import { randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { createPool, transaction } from './db.ts'
import { emptyEncounter } from '../shared/domain.ts'
if (process.env.NODE_ENV === 'production') throw new Error('Development seeding is disabled in production.')
const email = process.env.SEED_DM_EMAIL?.toLowerCase()
const password = process.env.SEED_DM_PASSWORD
if (!email || !password || password.length < 12) throw new Error('Set SEED_DM_EMAIL and SEED_DM_PASSWORD (12+ characters) for development seeding. No default password is supplied.')
const pool = createPool(process.env.DATABASE_URL!)
try {
  const hash = await argon2.hash(password, { type: argon2.argon2id })
  await transaction(pool, async db => {
    const existing = (await db.query('SELECT id FROM users WHERE email=$1', [email])).rows[0]
    if (existing) { console.log('Seed account already exists; leaving it unchanged'); return }
    const user = randomUUID(), campaign = randomUUID(), encounter = randomUUID()
    await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [user, email, hash])
    await db.query("INSERT INTO campaigns(id,owner_id,name) VALUES($1,$2,'Development campaign')", [campaign, user])
    await db.query("INSERT INTO encounters(id,campaign_id,name,state) VALUES($1,$2,'First encounter',$3)", [encounter, campaign, emptyEncounter()])
    await db.query('UPDATE campaigns SET active_encounter_id=$2 WHERE id=$1', [campaign, encounter])
    console.log('Development campaign seeded')
  })
} finally { await pool.end() }
