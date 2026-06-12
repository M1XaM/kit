// Save / Save as for the recording pages (Record Audio, Record Video, Screen
// Recording).
//
//   Save     → POSTs the clip to the backend, which stores it under
//              data/<feature-name>/ next to the installed binary.
//   Save as  → opens the browser's native save dialog (File System Access API)
//              so the user picks the location; falls back to a regular
//              download in browsers without showSaveFilePicker.

export type RecordingFeature = 'record-audio' | 'record-video' | 'screen-recording'

// saveToKit stores the blob server-side and resolves to the absolute path of
// the saved file (shown to the user as confirmation).
export async function saveToKit(blob: Blob, feature: RecordingFeature, filename: string): Promise<string> {
  const data = new FormData()
  data.append('feature', feature)
  data.append('file', new File([blob], filename, { type: blob.type }))
  const res = await fetch('/api/recordings/save', { method: 'POST', body: data })
  if (!res.ok) {
    throw new Error((await res.text()) || res.statusText)
  }
  const json = await res.json()
  if (!json.path) throw new Error('The server did not report a save location.')
  return json.path as string
}

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string
    types?: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>
}

// saveAs asks the user where to put the file. Returns false when the user
// cancelled the picker (not an error).
export async function saveAs(blob: Blob, filename: string): Promise<boolean> {
  const w = window as SaveFilePickerWindow
  if (w.showSaveFilePicker) {
    try {
      const ext = filename.includes('.') ? `.${filename.split('.').pop()}` : ''
      const handle = await w.showSaveFilePicker({
        suggestedName: filename,
        types: ext && blob.type
          ? [{ description: 'Recording', accept: { [blob.type]: [ext] } }]
          : undefined
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return true
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return false
      // Picker unavailable or failed (e.g. type restrictions): fall through to
      // the classic download below.
    }
  }
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  return true
}
