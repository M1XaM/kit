import { useEffect, useState, useRef } from 'react'
import { BrowserRouter, Routes, Route, Link, useNavigate, useParams, useLocation } from 'react-router-dom'
import './App.css'

const TOOLS = [
  {
    id: 'merge-pdf',
    title: 'Merge PDF',
    description: 'Combine PDFs in the order you want with the easiest PDF merger available.',
    icon: ( <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> ),
    colorClass: 'icon-red',
    apiEndpoint: '/api/pdf/merge'
  },
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
    id: 'pdf-to-word',
    title: 'PDF to Word',
    description: 'Easily convert your PDF files into easy to edit DOC and DOCX documents.',
    icon: ( <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> ),
    colorClass: 'icon-blue',
    apiEndpoint: '/api/pdf/to-word'
  },
  {
    id: 'pdf-to-excel',
    title: 'PDF to Excel',
    description: 'Pull data straight from PDFs into Excel spreadsheets in a few short seconds.',
    icon: ( <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M8 13h2"></path><path d="M8 17h2"></path><path d="M14 13h2"></path><path d="M14 17h2"></path></svg> ),
    colorClass: 'icon-green',
    apiEndpoint: '/api/pdf/to-excel'
  }
];

function HomeGrid() {
  const navigate = useNavigate();
  return (
    <>
      <div className="header">
        <h1>Every tool you need to work with your files locally</h1>
        <p>Every tool you need to use local media, at your fingertips. All are 100% FREE, entirely offline, and easy to use! Process, compress, convert, rotate, and manage native local files with just a few clicks without relying on cloud servers or facing bandwidth limits.</p>
      </div>
      
      <div className="categories">
        <button className="category-pill active">All</button>
        <button className="category-pill">Workflows</button>
        <button className="category-pill">Organize PDF</button>
        <button className="category-pill">Optimize PDF</button>
        <button className="category-pill">Convert PDF</button>
        <button className="category-pill">Edit Media</button>
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
            accept={id === 'png-to-jpg' ? 'image/png' : '*'} 
            ref={fileInputRef} 
            disabled={isProcessing}
            onChange={handleFileChange}
          />
        </label>
        <button 
          className="primary-btn"
          type="submit" 
          disabled={isProcessing || !selectedFileName}
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
        <div>
          <Link to="/" style={{color: 'inherit', textDecoration: 'none', fontWeight: 'bold'}}>Kit Local Hub</Link>
          <a href="kit://start" style={{marginLeft: '15px', padding: '4px 10px', background: '#333', color: '#fff', fontSize: '0.8rem', borderRadius: '4px', textDecoration: 'none'}}>🔖 Drag to Bookmarks to Install Launch Link</a>
        </div>
        <div>
          <span className={`status-dot ${status === 'Connected' ? 'connected' : 'disconnected'}`}></span>
          {status}
        </div>
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
