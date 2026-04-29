import { useEffect, useState, useRef } from 'react'

function App() {
  const [status, setStatus] = useState('Connecting...')
  const [isConverting, setIsConverting] = useState(false)
  const fileInputRef = useRef(null)

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

  const handleConvert = async (e) => {
    e.preventDefault();
    const file = fileInputRef.current?.files[0];
    if (!file) {
      alert("Please select a PNG file first");
      return;
    }

    setIsConverting(true);
    const formData = new FormData();
    formData.append("image", file);

    try {
      const response = await fetch('/api/convert/png-to-jpg', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errortext = await response.text();
        throw new Error(errortext || response.statusText);
      }

      // Download the response as a file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name.replace(/\.[^/.]+$/, "") + "_converted.jpg";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Conversion failed: " + err.message);
    } finally {
      setIsConverting(false);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Local Tools Hub</h1>
      <p>Connection Status: <strong style={{ color: status === 'Connected' ? 'green' : 'red' }}>{status}</strong></p>
      
      <div style={{ marginTop: '30px', padding: '20px', border: '1px solid #ccc', borderRadius: '8px', maxWidth: '500px' }}>
        <h2>PNG to JPG Converter</h2>
        <p>This bypasses browser memory and is handled entirely by the fast Go backend.</p>
        <form onSubmit={handleConvert}>
          <input 
            type="file" 
            accept="image/png" 
            ref={fileInputRef} 
            disabled={isConverting}
            style={{ marginBottom: '10px', display: 'block' }}
          />
          <button 
            type="submit" 
            disabled={isConverting}
            style={{ padding: '10px 15px', cursor: 'pointer', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px' }}
          >
            {isConverting ? 'Converting...' : 'Convert to JPG'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default App
