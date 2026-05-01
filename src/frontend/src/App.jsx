import { useEffect, useState, useRef } from 'react'
import { BrowserRouter, Routes, Route, Link, useNavigate, useParams, useLocation } from 'react-router-dom'
import './App.css'

const TOOLS = [
  {
    id: 'png-to-jpg',
    title: 'PNG to JPG',
    description: 'Convert PNG images to JPG in seconds. Easily handled locally to bypass limits.',
    icon: ( <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg> ),
    colorClass: 'icon-yellow',
    apiEndpoint: '/api/convert/png-to-jpg'
  },
  {
    id: 'compress-pdf',
    title: 'Compress PDF',
    description: 'Reduce file size while optimizing for maximal PDF quality.',
    icon: ( <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"></path><path d="M12 12v9"></path><path d="m8 17 4 4 4-4"></path></svg> ),
    colorClass: 'icon-green',
    apiEndpoint: '/api/pdf/compress'
  },
  {
    id: 'split-pdf',
    title: 'Split PDF',
    description: 'Split PDF pages by custom range or export each page into its own file.',
    icon: ( <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18"></path><path d="M6 3h12"></path><path d="M6 21h12"></path><path d="M4 8h4"></path><path d="M4 16h4"></path><path d="M16 8h4"></path><path d="M16 16h4"></path></svg> ),
    colorClass: 'icon-yellow',
    apiEndpoint: '/api/pdf/split'
  }
];

function HomeGrid() {
  const navigate = useNavigate();
  return (
    <>
      <div className="header">
        <h1>Kit</h1>
        <p>The all-in-one toolkit for working with files — directly on your machine.</p>
      </div>

      <div className="grid">
        {TOOLS.map(tool => (
          <div className="card" key={tool.id} onClick={() => navigate('/tool/' + tool.id)}>
            <div className={`card-icon ${tool.colorClass}`}>
              {tool.icon}
            </div>
            <h3>{tool.title}</h3>
            <p>{tool.description}</p>
          </div>
        ))}
      </div>
    </>
  )
}

function ToolView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const tool = TOOLS.find(t => t.id === id);
  
  const [isProcessing, setIsProcessing] = useState(false)
  const fileInputRef = useRef(null)
  const [selectedFileName, setSelectedFileName] = useState('')
  const [splitMode, setSplitMode] = useState('range')
  const [splitRange, setSplitRange] = useState('1-2')

  if (!tool) {
    return (
      <div className="tool-view">
         <h2>Tool not found</h2>
         <button className="back-btn" onClick={() => navigate('/')}>Back to Tools</button>
      </div>
    );
  }

  const handleProcess = async (e) => {
    e.preventDefault();
    const file = fileInputRef.current?.files[0];
    if (!file) {
      alert("Please select a file first");
      return;
    }

    setIsProcessing(true);
    const formData = new FormData();
    formData.append("image", file); // using image key for png conversion, backend ignores for mock routes
    formData.append("file", file);
    if (id === 'split-pdf') {
      formData.append("mode", splitMode);
      if (splitMode === 'range') {
        formData.append("pages", splitRange);
      }
    }

    try {
      const response = await fetch(tool.apiEndpoint, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errortext = await response.text();
        throw new Error(errortext || response.statusText);
      }

      // Check header or fallback string split logic for extension
      const disp = response.headers.get("content-disposition");
      let downloadFilename = file.name.replace(/\.[^/.]+$/, "") + "_output";

      if (id === 'png-to-jpg') downloadFilename += '.jpg';
      else if (id === 'split-pdf') downloadFilename += splitMode === 'per-page' ? '.zip' : '.pdf';
      else downloadFilename += '.txt';

      if (disp && disp.includes("filename=")) {
         downloadFilename = disp.split("filename=")[1].replace(/"/g, "");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadFilename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      
      // Cleanup for UI
      setSelectedFileName('')
      if (fileInputRef.current) fileInputRef.current.value = ""

    } catch (err) {
      alert("Processing failed: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileChange = () => {
    if (fileInputRef.current?.files[0]) {
      setSelectedFileName(fileInputRef.current.files[0].name);
    }
  }

  return (
    <div className="tool-view">
      <Link to="/" className="back-btn" style={{display: 'inline-flex', alignItems: 'center', textDecoration: 'none', color: '#a0a0a0', marginBottom: '20px'}}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '8px'}}><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        Back to Tools
      </Link>
      <h2>{tool.title}</h2>
      <p style={{color: '#a0a0a0'}}>This bypasses browser memory and is handled entirely by the fast Go backend right on your machine.</p>
      
      <form onSubmit={handleProcess}>
        <label className="file-input">
            <svg style={{marginBottom: '10px'}} width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            <div>{selectedFileName ? selectedFileName : "Click or drag a file to upload"}</div>
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
              onChange={(e) => setSplitMode(e.target.value)}
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
                  onChange={(e) => setSplitRange(e.target.value)}
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
  );
}

function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="tool-view" style={{ textAlign: 'center', marginTop: '50px' }}>
      <h1>404 - Page Not Found</h1>
      <p style={{ color: '#a0a0a0', marginBottom: '30px' }}>Oops! The page you're looking for doesn't exist.</p>
      <button className="primary-btn" onClick={() => navigate('/')} style={{ margin: '0 auto', display: 'block', maxWidth: '200px' }}>
        Return to Home
      </button>
    </div>
  );
}

function MainLayout() {
  const [status, setStatus] = useState('Connecting...')
  const location = useLocation()

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    let ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setStatus('Connected');
      const interval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send('ping');
        }
      }, 2000);
      return () => clearInterval(interval);
    };

    ws.onclose = () => setStatus('Disconnected');
    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      setStatus('Error connecting');
    };

    return () => ws.close();
  }, []);

  return (
    <>
      <div className="status-bar">
        <div className="status-left">
          <a href="kit://start" className="status-pill-link">Drag me to your bookmarks!</a>
          <a href="#" className="status-pill-link">
            Explore extension
            <span className="soon-badge">Soon</span>
          </a>
        </div>
        <div className="status-right">
          <a href="https://m1xam.github.io/kit/" className="status-pill-link">Landing page</a>
          <div className="status-connection-wrap">
            <div className="status-pill-link status-connection-pill">
              <span className={`status-dot ${status === 'Connected' ? 'connected' : 'disconnected'}`}></span>
              {status}
            </div>
            <div className="status-connection-tooltip">
              Local background server is running while this tab is open and shuts down when you close it.
            </div>
          </div>
        </div>
      </div>

      <div className={`page-content ${location.pathname === '/' ? 'page-content-home' : ''}`}>
        <div className="bg-glow" />
        <div className="bg-grid" />
      </div>
      <div className="container">
        <Routes>
          <Route path="/" element={<HomeGrid />} />
          <Route path="/tool/:id" element={<ToolView />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
    </>
  )
}

function App() {
  return (
    <BrowserRouter>
      <MainLayout />
    </BrowserRouter>
  )
}

export default App
