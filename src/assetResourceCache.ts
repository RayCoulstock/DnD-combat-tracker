export interface CachedResource<T> { value: T; bytes: number; dispose: () => void }
interface Entry<T> { users: number; promise: Promise<T>; resource?: CachedResource<T>; controller: AbortController; timer?: ReturnType<typeof setTimeout>; discarded: boolean }
// Coalesce requests, bound distinct models/memory, and never dispose a resource in use.
export class AssetResourceCache<T> {
  private entries = new Map<string, Entry<T>>()
  private bytes = 0; private running = 0; private waiting: Array<() => void> = []
  constructor(private load: (key: string, signal: AbortSignal) => Promise<CachedResource<T>>, private maxEntries = 16, private maxBytes = 256 * 1024 * 1024, private idleMs = 1000) {}
  private remove(key: string, entry: Entry<T>) {
    if (entry.users || entry.discarded) return
    entry.discarded = true; clearTimeout(entry.timer); entry.controller.abort()
    if (this.entries.get(key) === entry) this.entries.delete(key)
    if (entry.resource) { this.bytes -= entry.resource.bytes; entry.resource.dispose() }
  }
  private async limited(load: () => Promise<CachedResource<T>>) {
    if (this.running >= 2) await new Promise<void>(r => this.waiting.push(r)); else this.running++
    try { return await load() } finally { const next = this.waiting.shift(); if (next) next(); else this.running-- }
  }
  acquire(key: string) {
    let entry = this.entries.get(key)
    if (!entry) {
      for (const [k, candidate] of this.entries) if (this.entries.size >= this.maxEntries && !candidate.users) this.remove(k, candidate)
      if (this.entries.size >= this.maxEntries) return { promise: Promise.reject<T>(new Error('Miniature model budget reached. Use fewer distinct models.')), release() {} }
      const created: Entry<T> = { users: 0, controller: new AbortController(), discarded: false, promise: undefined! }
      created.promise = this.limited(() => this.load(key, created.controller.signal)).then(resource => {
        for (const [k, candidate] of this.entries) if (this.bytes + resource.bytes > this.maxBytes && !candidate.users && candidate !== created) this.remove(k, candidate)
        if (created.discarded || this.bytes + resource.bytes > this.maxBytes) { resource.dispose(); throw new Error('Miniature exceeds the available model memory budget.') }
        created.resource = resource; this.bytes += resource.bytes; return resource.value
      }).catch(error => { if (this.entries.get(key) === created) this.entries.delete(key); throw error })
      entry = created; this.entries.set(key, entry)
    }
    entry.users++; clearTimeout(entry.timer)
    let released = false
    const acquired = entry
    return { promise: acquired.promise, release: () => { if (released) return; released = true; acquired.users--; if (!acquired.users) acquired.timer = setTimeout(() => this.remove(key, acquired), this.idleMs) } }
  }
}
