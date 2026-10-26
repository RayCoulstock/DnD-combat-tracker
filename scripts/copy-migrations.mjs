import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { URL, fileURLToPath } from 'node:url'

export async function copyMigrations(root = fileURLToPath(new URL('../', import.meta.url))) {
  const source = resolve(root, 'server/migrations'), target = resolve(root, 'dist-server/server/migrations')
  const files = (await readdir(source)).filter(file => file.endsWith('.sql')).sort()
  if (!files.length) throw new Error('No database migrations found.')
  // Remove stale compiled SQL, never database data or uploaded files.
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  for (const file of files) await cp(resolve(source, file), resolve(target, file))
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await copyMigrations()
