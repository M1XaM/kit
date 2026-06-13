// Recent files store.
//
// When a user loads a file into a feature (file picker or drag&drop) the
// browser hands us a `File` object. A `File` is just a lightweight reference to
// the bytes that already live on the user's disk — reading it pulls from the
// original file on demand, it does NOT copy the data into the page. So we keep
// those `File` references in memory and the right-hand "Recent files" panel
// previews / re-drags straight from them.
//
// This deliberately does NOT persist the bytes anywhere (no IndexedDB, no
// localStorage): duplicating every opened file into browser storage would
// occupy twice the space for no reason. The trade-off is that the list lives
// for the session only — browsers, for security, never expose a file's path and
// never let a `File` from an <input>/drop be re-opened after a reload, so a
// durable on-disk "link" simply isn't available to web code. Reloading the page
// starts the list fresh.

const MAX_ENTRIES = 40

export type RecentFileMeta = {
  id: string
  name: string
  size: number
  type: string
  addedAt: number
  feature: string
}

type RecentEntry = { meta: RecentFileMeta; file: File }

// Insertion-ordered map of live File references, keyed by a content fingerprint.
const entries = new Map<string, RecentEntry>()

// --- change notifications ---------------------------------------------------
const listeners = new Set<() => void>()

export function subscribeRecentFiles(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notify() {
  listeners.forEach((fn) => fn())
}

// A stable identity so re-loading the same file just refreshes its timestamp
// instead of piling up duplicates. Browsers don't give us a path, so
// name + size + type is the best fingerprint available.
function fileKey(file: { name: string; size: number; type: string }): string {
  return `${file.name}::${file.size}::${file.type}`
}

// --- public API -------------------------------------------------------------

export function addRecentFile(file: File, feature: string): void {
  if (!file || file.size === 0) return

  const id = fileKey(file)
  // Re-adding moves the entry to the front (most recent) and refreshes its time.
  entries.delete(id)
  entries.set(id, {
    file,
    meta: {
      id,
      name: file.name || 'file',
      size: file.size,
      type: file.type || '',
      addedAt: Date.now(),
      feature: feature || '',
    },
  })

  // Evict the oldest references once we exceed the cap. We only drop our own
  // pointers here; the underlying files on disk are untouched.
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value
    if (oldest === undefined) break
    entries.delete(oldest)
  }

  notify()
}

export function listRecentFiles(): RecentFileMeta[] {
  return Array.from(entries.values())
    .map((e) => e.meta)
    .sort((a, b) => b.addedAt - a.addedAt)
}

export function getRecentFile(id: string): File | null {
  return entries.get(id)?.file ?? null
}

export function deleteRecentFile(id: string): void {
  if (entries.delete(id)) notify()
}

export function clearRecentFiles(): void {
  if (entries.size === 0) return
  entries.clear()
  notify()
}
