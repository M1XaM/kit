import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as openpgp from 'openpgp'
import { createMD5 } from 'hash-wasm'
import { sha1 } from '@noble/hashes/sha1'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import FeatureHeader from './FeatureHeader'
import type { Tool } from './toolData'

const ALGORITHMS = {
  sha256: { label: 'SHA-256', create: () => sha256.create() },
  sha1: { label: 'SHA-1', create: () => sha1.create() },
  md5: { label: 'MD5', create: async () => createMD5() }
}

type ChecksumViewProps = {
  tool: Tool
}

function ChecksumView({ tool }: ChecksumViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [algorithm, setAlgorithm] = useState('sha256')
  const [expectedHash, setExpectedHash] = useState('')
  const [computedHash, setComputedHash] = useState('')
  const [status, setStatus] = useState('idle')
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [showGpgPanel, setShowGpgPanel] = useState(false)
  const [gpgKeyFile, setGpgKeyFile] = useState<File | null>(null)
  const [gpgSignatureFile, setGpgSignatureFile] = useState<File | null>(null)
  const [gpgStatus, setGpgStatus] = useState('idle')
  const [gpgError, setGpgError] = useState('')
  const [isGpgProcessing, setIsGpgProcessing] = useState(false)
  const [gpgFetchStatus, setGpgFetchStatus] = useState('idle')
  const [gpgFetchMessage, setGpgFetchMessage] = useState('')
  const gpgKeyInputRef = useRef<HTMLInputElement | null>(null)
  const gpgSignatureInputRef = useRef<HTMLInputElement | null>(null)
  const dropZoneClass = `flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center text-slate-400 transition ${dragActive ? 'border-blue-400/70 bg-blue-600/20 text-slate-200' : 'border-white/20 hover:border-white/30 hover:bg-white/5'}`

  const updateFile = (file: File) => {
    setSelectedFile(file)
    setComputedHash('')
    setStatus('idle')
    setProgress(0)
    setErrorMessage('')
    setGpgStatus('idle')
    setGpgError('')
    setGpgSignatureFile(null)
    setGpgFetchStatus('idle')
    setGpgFetchMessage('')
  }

  const handleDragOver = (event) => {
    event.preventDefault()
    setDragActive(true)
  }

  const handleDragLeave = (event) => {
    event.preventDefault()
    setDragActive(false)
  }

  const handleDrop = (event) => {
    event.preventDefault()
    setDragActive(false)
    const files = Array.from(event.dataTransfer.files || [])
    if (files.length) {
      updateFile(files[0])
    }
  }

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files || [])
    if (files.length) {
      updateFile(files[0])
    }
  }

  const normalizeHash = (value: string) => value.replace(/[^a-fA-F0-9]/g, '').toLowerCase()

  const computeHash = async (file: File) => {
    const hasher = await ALGORITHMS[algorithm].create()
    const total = file.size || 0
    let processed = 0
    let lastUpdate = 0

    if (file.stream) {
      const reader = file.stream().getReader()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (value) {
          hasher.update(value)
          processed += value.length
        }
        const now = Date.now()
        if (total && now - lastUpdate > 120) {
          setProgress(Math.min(100, Math.round((processed / total) * 100)))
          lastUpdate = now
        }
      }
    } else {
      const chunkSize = 4 * 1024 * 1024
      while (processed < total) {
        const slice = file.slice(processed, processed + chunkSize)
        const buffer = new Uint8Array(await slice.arrayBuffer())
        hasher.update(buffer)
        processed += buffer.length
        setProgress(Math.min(100, Math.round((processed / total) * 100)))
      }
    }

    setProgress(100)
    const digest = hasher.digest()
    if (typeof digest === 'string') {
      return digest.toLowerCase()
    }
    return bytesToHex(digest)
  }

  const handleGpgKeyPick = () => {
    setShowGpgPanel(true)
    if (!selectedFile) {
      setErrorMessage('Please select a file first.')
      return
    }
    gpgKeyInputRef.current?.click()
  }

  const handleGpgSignaturePick = () => {
    setShowGpgPanel(true)
    if (!selectedFile) {
      setErrorMessage('Please select a file first.')
      return
    }
    gpgSignatureInputRef.current?.click()
  }

  const handleGpgKeyChange = (event) => {
    const files = Array.from(event.target.files || [])
    if (!files.length) return
    setGpgKeyFile(files[0])
    setGpgStatus('idle')
    setGpgError('')
    setGpgFetchStatus('idle')
    setGpgFetchMessage('')
    setShowGpgPanel(true)
  }

  const handleGpgSignatureChange = (event) => {
    const files = Array.from(event.target.files || [])
    if (!files.length) return
    setGpgSignatureFile(files[0])
    setGpgStatus('idle')
    setGpgError('')
    setShowGpgPanel(true)
    void tryAutoFetchKey(files[0])
  }

  const readKeyFile = async (file) => {
    const buffer = new Uint8Array(await file.arrayBuffer())
    const text = new TextDecoder().decode(buffer)
    if (text.includes('BEGIN PGP')) {
      return openpgp.readKey({ armoredKey: text })
    }
    return openpgp.readKey({ binaryKey: buffer })
  }

  const readSignatureFile = async (file) => {
    const buffer = new Uint8Array(await file.arrayBuffer())
    const text = new TextDecoder().decode(buffer)
    if (text.includes('BEGIN PGP')) {
      return openpgp.readSignature({ armoredSignature: text })
    }
    return openpgp.readSignature({ binarySignature: buffer })
  }

  const extractKeyIdHex = (signature) => {
    if (!signature) return ''
    if (typeof signature.getSigningKeyID === 'function') {
      return signature.getSigningKeyID().toHex()
    }
    if (typeof signature.getSigningKeyIDs === 'function') {
      const ids = signature.getSigningKeyIDs()
      if (ids && ids.length) {
        return ids[0].toHex()
      }
    }
    if (signature.signingKeyId) {
      return signature.signingKeyId.toHex ? signature.signingKeyId.toHex() : String(signature.signingKeyId)
    }
    return ''
  }

  const fetchPublicKeyByKeyId = async (keyId) => {
    const response = await fetch(`https://keys.openpgp.org/vks/v1/by-keyid/${keyId}`)
    if (!response.ok) {
      throw new Error(`Key server returned ${response.status}`)
    }
    const buffer = new Uint8Array(await response.arrayBuffer())
    const text = new TextDecoder().decode(buffer)
    const isArmored = text.includes('BEGIN PGP')
    const extension = isArmored ? 'asc' : 'gpg'
    return new File([buffer], `key-${keyId}.${extension}`, {
      type: isArmored ? 'application/pgp-keys' : 'application/octet-stream'
    })
  }

  const tryAutoFetchKey = async (signatureFile) => {
    if (gpgKeyFile || !signatureFile) return
    setGpgFetchStatus('loading')
    setGpgFetchMessage('')

    try {
      const signature = await readSignatureFile(signatureFile)
      const keyId = extractKeyIdHex(signature)
      if (!keyId) {
        setGpgFetchStatus('failed')
        setGpgFetchMessage('Signature does not include a key ID.')
        return
      }

      const fetchedKeyFile = await fetchPublicKeyByKeyId(keyId)
      setGpgKeyFile(fetchedKeyFile)
      setGpgFetchStatus('success')
      setGpgFetchMessage(`Fetched key ${keyId} from keys.openpgp.org`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch public key.'
      setGpgFetchStatus('failed')
      setGpgFetchMessage(message)
    }
  }

  const verifySignature = async () => {
    if (!selectedFile) {
      setGpgError('Please select a file first.')
      return
    }
    if (!gpgKeyFile || !gpgSignatureFile) {
      setGpgError('Please select a public key and signature file.')
      return
    }

    setIsGpgProcessing(true)
    setGpgError('')

    try {
      const publicKey = await readKeyFile(gpgKeyFile)
      const signature = await readSignatureFile(gpgSignatureFile)
      const payload = selectedFile.stream
        ? selectedFile.stream()
        : new Uint8Array(await selectedFile.arrayBuffer())
      const message = await openpgp.createMessage({ binary: payload })
      const result = await openpgp.verify({
        message,
        signature,
        verificationKeys: publicKey
      })
      const { verified } = result.signatures[0]
      await verified
      setGpgStatus('verified')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Signature verification failed.'
      setGpgStatus('failed')
      setGpgError(message)
    } finally {
      setIsGpgProcessing(false)
    }
  }

  const handleCompute = async (event) => {
    event.preventDefault()
    if (!selectedFile) {
      setErrorMessage('Please select a file first.')
      return
    }

    setIsProcessing(true)
    setErrorMessage('')

    try {
      const digest = await computeHash(selectedFile)
      setComputedHash(digest)

      const expected = normalizeHash(expectedHash)
      if (expected) {
        setStatus(expected === digest.toLowerCase() ? 'match' : 'mismatch')
      } else {
        setStatus('idle')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Checksum calculation failed.'
      setErrorMessage(message)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-white/5 p-10 text-left backdrop-blur">
      <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back to Tools
      </Link>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className={`flex h-14 w-14 items-center justify-center rounded-xl ${tool.colorClass}`}>
            {Icon ? <Icon /> : null}
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-50">{tool.title}</h2>
            <p className="text-sm text-slate-400">All hashing runs in your browser with streaming for large files.</p>
          </div>
        </div>
        <RuntimePill tool={tool} />
      </div>

      {errorMessage && <div className="mt-5 rounded-xl border border-red-400/50 bg-red-900/25 px-4 py-3 text-sm text-red-200">{errorMessage}</div>}

      <form className="mt-8 flex flex-col gap-5" onSubmit={handleCompute}>
        <label
          className={dropZoneClass}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <svg className="mb-2" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
          <div className="text-sm text-slate-200">
            {selectedFile ? selectedFile.name : 'Drag and drop a file here'}
          </div>
          <div className="mt-2 text-xs text-slate-400">or click to choose a file</div>
          <input
            type="file"
            ref={fileInputRef}
            disabled={isProcessing}
            onChange={handleFileChange}
            className="hidden"
          />
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label htmlFor="checksum-algorithm" className="text-xs uppercase tracking-[0.12em] text-slate-400">Algorithm</label>
            <select
              id="checksum-algorithm"
              value={algorithm}
              onChange={(event) => setAlgorithm(event.target.value)}
              disabled={isProcessing}
              className="w-full rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-white"
            >
              {Object.entries(ALGORITHMS).map(([value, { label }]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="checksum-expected" className="text-xs uppercase tracking-[0.12em] text-slate-400">Expected hash (optional)</label>
            <div className="relative">
              <input
                id="checksum-expected"
                type="text"
                value={expectedHash}
                onChange={(event) => setExpectedHash(event.target.value)}
                disabled={isProcessing}
                placeholder="Paste checksum to verify"
                className="w-full rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 pr-24 text-sm text-white"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg border border-blue-400/40 bg-blue-600/20 px-2.5 py-1 text-[0.7rem] font-semibold text-blue-200"
                onClick={handleGpgSignaturePick}
                disabled={isProcessing}
              >
                Use GPG
              </button>
            </div>
            <input
              type="file"
              accept=".asc,.gpg,.pgp,.key"
              ref={gpgKeyInputRef}
              onChange={handleGpgKeyChange}
              className="hidden"
            />
          </div>
        </div>

        {(showGpgPanel || gpgKeyFile) && (
          <div className="rounded-xl border border-white/10 bg-slate-900/50 p-4">
            <div className="grid gap-3 md:grid-cols-[minmax(90px,auto)_1fr_auto] items-center">
              <div className="text-[0.7rem] uppercase tracking-[0.12em] text-slate-400">Public key</div>
              <div className="text-sm text-slate-200 break-all">{gpgKeyFile ? gpgKeyFile.name : 'Not selected'}</div>
              <button type="button" className="rounded-lg border border-slate-400/40 bg-slate-400/15 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-400/25" onClick={handleGpgKeyPick}>
                Choose key
              </button>
            </div>
            {gpgFetchStatus !== 'idle' && (
              <div className={`mt-2 text-xs ${gpgFetchStatus === 'success' ? 'text-emerald-300' : gpgFetchStatus === 'loading' ? 'text-slate-300' : 'text-red-300'}`}>
                {gpgFetchStatus === 'loading' ? 'Fetching key from keys.openpgp.org...' : gpgFetchMessage}
              </div>
            )}
            <div className="mt-3 grid gap-3 md:grid-cols-[minmax(90px,auto)_1fr_auto] items-center">
              <div className="text-[0.7rem] uppercase tracking-[0.12em] text-slate-400">Signature</div>
              <div className="text-sm text-slate-200 break-all">{gpgSignatureFile ? gpgSignatureFile.name : 'Not selected'}</div>
              <button type="button" className="rounded-lg border border-slate-400/40 bg-slate-400/15 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-400/25" onClick={handleGpgSignaturePick}>
                Choose signature
              </button>
              <input
                type="file"
                accept=".sig,.asc,.gpg,.pgp"
                ref={gpgSignatureInputRef}
                onChange={handleGpgSignatureChange}
                className="hidden"
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                disabled={isGpgProcessing || !selectedFile || !gpgKeyFile || !gpgSignatureFile}
                onClick={verifySignature}
              >
                {isGpgProcessing ? 'Verifying...' : 'Verify Signature'}
              </button>
              {gpgStatus !== 'idle' && (
                <div className={`inline-flex items-center rounded-full border px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] ${gpgStatus === 'verified' ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200' : 'border-red-400/50 bg-red-500/20 text-red-200'}`}>
                  {gpgStatus === 'verified' ? 'Signature verified' : 'Signature failed'}
                </div>
              )}
            </div>
            {gpgError && <div className="mt-3 rounded-xl border border-red-400/50 bg-red-900/25 px-4 py-3 text-sm text-red-200">{gpgError}</div>}
            <div className="mt-3 text-xs text-slate-400">Signature verification uses the selected public key and does not upload files.</div>
          </div>
        )}

        {isProcessing && (
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700/40">
            <div className="h-full bg-gradient-to-r from-sky-400 via-cyan-400 to-fuchsia-500" style={{ width: `${progress}%` }} />
          </div>
        )}

        {computedHash && (
          <div className="rounded-xl border border-slate-400/20 bg-slate-900/50 p-4">
            <div className="text-[0.7rem] uppercase tracking-[0.14em] text-slate-400">Computed hash</div>
            <div className="mt-2 font-mono text-sm text-slate-200 break-all">{computedHash}</div>
            {expectedHash.trim() && status !== 'idle' && (
              <div className={`mt-3 inline-flex items-center rounded-full border px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] ${status === 'match' ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200' : 'border-red-400/50 bg-red-500/20 text-red-200'}`}>
                {status === 'match' ? 'Match' : 'Mismatch'}
              </div>
            )}
          </div>
        )}

        <button
          className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          type="submit"
          disabled={isProcessing || !selectedFile}
        >
          {isProcessing ? 'Calculating...' : 'Compute Checksum'}
        </button>
      </form>
    </div>
  )
}

export default ChecksumView
