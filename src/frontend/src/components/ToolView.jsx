import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { TOOLS } from './toolData'
import ComingSoon from './ComingSoon'
import NotFound from './NotFound'
import PerformanceViewer from './PerformanceViewer'
import InternetSpeed from './InternetSpeed'
import ArchiveToolView from './ArchiveToolView'
import ChecksumView from './ChecksumView'
import TextToolView from './TextToolView'
import RecordAudioView from './RecordAudioView'

function ToolView() {
  const { id } = useParams()
  const tool = TOOLS.find((item) => item.id === id)

  const [isProcessing, setIsProcessing] = useState(false)
  const fileInputRef = useRef(null)
  const [selectedFileName, setSelectedFileName] = useState('')
  const [splitMode, setSplitMode] = useState('range')
  const [splitRange, setSplitRange] = useState('1-2')

  if (!tool) {
    return <NotFound />
  }

  if (tool.comingSoon) {
    return <ComingSoon tool={tool} />
  }

  const customViews = {
    'performance-viewer': PerformanceViewer,
    'internet-test': InternetSpeed,
    'archive-extract': ArchiveToolView,
    'archive-create': ArchiveToolView,
    'checksum-verify': ChecksumView,
    'metadata-edit': TextToolView,
    'text-compare': TextToolView,
    'markdown-diff': TextToolView,
    'hash-generator': TextToolView,
    'base64-encode-decode': TextToolView,
    'hex-encode-decode': TextToolView,
    'url-encode-decode': TextToolView,
    'text-encoding-convert': TextToolView,
    'record-audio': RecordAudioView
  }
  const CustomView = customViews[id]
  if (CustomView) {
    return <CustomView tool={tool} />
  }

  const handleProcess = async (event) => {
    event.preventDefault()
    const file = fileInputRef.current?.files[0]
    if (!file) {
      alert('Please select a file first')
      return
    }

    setIsProcessing(true)
    const formData = new FormData()
    formData.append('image', file)
    formData.append('file', file)
    if (id === 'split-pdf') {
      formData.append('mode', splitMode)
      if (splitMode === 'range') {
        formData.append('pages', splitRange)
      }
    }

    try {
      const response = await fetch(tool.apiEndpoint, {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || response.statusText)
      }

      const disp = response.headers.get('content-disposition')
      let downloadFilename = file.name.replace(/\.[^/.]+$/, '') + '_output'

      if (id === 'png-to-jpg') downloadFilename += '.jpg'
      else if (id === 'split-pdf') downloadFilename += splitMode === 'per-page' ? '.zip' : '.pdf'
      else downloadFilename += '.txt'

      if (disp && disp.includes('filename=')) {
        downloadFilename = disp.split('filename=')[1].replace(/"/g, '')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = downloadFilename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(url)

      setSelectedFileName('')
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      alert('Processing failed: ' + err.message)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleFileChange = () => {
    if (fileInputRef.current?.files[0]) {
      setSelectedFileName(fileInputRef.current.files[0].name)
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
      <h2 className="text-2xl font-semibold text-slate-50">{tool.title}</h2>
      <p className="mt-2 text-sm text-slate-400">This bypasses browser memory and is handled entirely by the fast Go backend right on your machine.</p>

      <form className="mt-8 flex flex-col gap-5" onSubmit={handleProcess}>
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/20 bg-transparent p-10 text-center text-slate-400 transition hover:border-white/30 hover:bg-white/5">
          <svg className="mb-2" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
          <div className="text-sm text-slate-200">{selectedFileName ? selectedFileName : 'Click or drag a file to upload'}</div>
          <input
            type="file"
            accept={id === 'png-to-jpg' ? 'image/png' : id === 'split-pdf' ? 'application/pdf' : '*'}
            ref={fileInputRef}
            disabled={isProcessing}
            onChange={handleFileChange}
            className="hidden"
          />
        </label>
        {id === 'split-pdf' && (
          <div className="text-left">
            <label className="mb-2 block text-xs uppercase tracking-[0.12em] text-slate-400">Split mode</label>
            <select
              value={splitMode}
              onChange={(event) => setSplitMode(event.target.value)}
              disabled={isProcessing}
              className="w-full rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-white"
            >
              <option value="range">By range</option>
              <option value="per-page">Per page (ZIP)</option>
            </select>

            {splitMode === 'range' && (
              <>
                <label className="mb-2 mt-4 block text-xs uppercase tracking-[0.12em] text-slate-400">Page range</label>
                <input
                  type="text"
                  value={splitRange}
                  onChange={(event) => setSplitRange(event.target.value)}
                  disabled={isProcessing}
                  placeholder="Example: 1-3,5"
                  className="w-full rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-white"
                />
              </>
            )}
          </div>
        )}
        <button
          className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          type="submit"
          disabled={isProcessing || !selectedFileName || (id === 'split-pdf' && splitMode === 'range' && !splitRange.trim())}
        >
          {isProcessing ? 'Processing...' : 'Process File'}
        </button>
      </form>
    </div>
  )
}

export default ToolView
