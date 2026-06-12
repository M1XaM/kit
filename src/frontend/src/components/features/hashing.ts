import { createMD5, createCRC32 } from 'hash-wasm'
import { sha1 } from '@noble/hashes/sha1'
import { sha256, sha384, sha512 } from '@noble/hashes/sha2'
import { sha3_256, sha3_512 } from '@noble/hashes/sha3'
import { bytesToHex } from '@noble/hashes/utils'

// One hashing registry shared by every feature that hashes (Hash Generator,
// Checksum Verification). MD5 and CRC32 come from hash-wasm (WebAssembly);
// the SHA family comes from @noble/hashes (pure JS). All of them support
// incremental updates so large files can be streamed.

export type Hasher = {
  update(data: Uint8Array): void
  digestHex(): string
}

export type HashAlgorithm = {
  label: string
  create(): Promise<Hasher>
}

const nobleHasher = (factory: () => { update(data: Uint8Array): unknown; digest(): Uint8Array }): Hasher => {
  const h = factory()
  return {
    update: (data) => h.update(data),
    digestHex: () => bytesToHex(h.digest())
  }
}

const wasmHasher = async (create: () => Promise<{ init(): unknown; update(data: Uint8Array): unknown; digest(): string }>): Promise<Hasher> => {
  const h = await create()
  h.init()
  return {
    update: (data) => h.update(data),
    digestHex: () => String(h.digest()).toLowerCase()
  }
}

export const HASH_ALGORITHMS: Record<string, HashAlgorithm> = {
  sha256: { label: 'SHA-256', create: async () => nobleHasher(() => sha256.create()) },
  sha512: { label: 'SHA-512', create: async () => nobleHasher(() => sha512.create()) },
  sha384: { label: 'SHA-384', create: async () => nobleHasher(() => sha384.create()) },
  sha1: { label: 'SHA-1', create: async () => nobleHasher(() => sha1.create()) },
  md5: { label: 'MD5', create: () => wasmHasher(createMD5) },
  'sha3-256': { label: 'SHA3-256', create: async () => nobleHasher(() => sha3_256.create()) },
  'sha3-512': { label: 'SHA3-512', create: async () => nobleHasher(() => sha3_512.create()) },
  crc32: { label: 'CRC32', create: () => wasmHasher(createCRC32) }
}

export const hashText = async (algorithm: string, text: string): Promise<string> => {
  const algo = HASH_ALGORITHMS[algorithm]
  if (!algo) throw new Error(`Unknown algorithm: ${algorithm}`)
  const hasher = await algo.create()
  hasher.update(new TextEncoder().encode(text))
  return hasher.digestHex()
}

// hashFile streams the file through the hasher in chunks, reporting progress
// as a 0-100 percentage.
export const hashFile = async (
  algorithm: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<string> => {
  const algo = HASH_ALGORITHMS[algorithm]
  if (!algo) throw new Error(`Unknown algorithm: ${algorithm}`)
  const hasher = await algo.create()
  const total = file.size || 0
  let processed = 0
  let lastUpdate = 0

  const report = () => {
    const now = Date.now()
    if (total && onProgress && now - lastUpdate > 120) {
      onProgress(Math.min(100, Math.round((processed / total) * 100)))
      lastUpdate = now
    }
  }

  if (file.stream) {
    const reader = file.stream().getReader()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) {
        hasher.update(value)
        processed += value.length
      }
      report()
    }
  } else {
    const chunkSize = 4 * 1024 * 1024
    while (processed < total) {
      const slice = (file as File).slice(processed, processed + chunkSize)
      const buffer = new Uint8Array(await slice.arrayBuffer())
      hasher.update(buffer)
      processed += buffer.length
      report()
    }
  }

  onProgress?.(100)
  return hasher.digestHex()
}
