import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { TOOLS } from './toolData'
import ComingSoon from './ComingSoon'
import NotFound from './NotFound'

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
    <div className="tool-view">
      <Link to="/" className="back-btn">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back to Tools
      </Link>
      <h2>{tool.title}</h2>
      <p style={{ color: '#a0a0a0' }}>This bypasses browser memory and is handled entirely by the fast Go backend right on your machine.</p>

      <form onSubmit={handleProcess}>
        <label className="file-input">
          <svg style={{ marginBottom: '10px' }} width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
          <div>{selectedFileName ? selectedFileName : 'Click or drag a file to upload'}</div>
          <input
            type="file"
            accept={id === 'png-to-jpg' ? 'image/png' : id === 'split-pdf' ? 'application/pdf' : '*'}
            ref={fileInputRef}
            disabled={isProcessing}
            onChange={handleFileChange}
          />
        </label>
        {id === 'split-pdf' && (
          <div style={{ marginTop: '12px', marginBottom: '12px', textAlign: 'left' }}>
            <label style={{ display: 'block', marginBottom: '8px', color: '#a0a0a0' }}>Split mode</label>
            <select
              value={splitMode}
              onChange={(event) => setSplitMode(event.target.value)}
              disabled={isProcessing}
              style={{
                width: '100%',
                background: '#131314',
                border: '1px solid #2c2c2e',
                color: '#fff',
                borderRadius: '8px',
                padding: '10px'
              }}
            >
              <option value="range">By range</option>
              <option value="per-page">Per page (ZIP)</option>
            </select>

            {splitMode === 'range' && (
              <>
                <label style={{ display: 'block', marginTop: '12px', marginBottom: '8px', color: '#a0a0a0' }}>
                  Page range
                </label>
                <input
                  type="text"
                  value={splitRange}
                  onChange={(event) => setSplitRange(event.target.value)}
                  disabled={isProcessing}
                  placeholder="Example: 1-3,5"
                  style={{
                    width: '100%',
                    background: '#131314',
                    border: '1px solid #2c2c2e',
                    color: '#fff',
                    borderRadius: '8px',
                    padding: '10px'
                  }}
                />
              </>
            )}
          </div>
        )}
        <button
          className="primary-btn"
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
