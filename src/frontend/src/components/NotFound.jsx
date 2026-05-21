import { useNavigate } from 'react-router-dom'

function NotFound() {
  const navigate = useNavigate()
  return (
    <div className="tool-view not-found">
      <h1>404 - Page Not Found</h1>
      <p className="not-found-text">Oops! The page you're looking for doesn't exist.</p>
      <button className="primary-btn not-found-btn" onClick={() => navigate('/')}>
        Return to Home
      </button>
    </div>
  )
}

export default NotFound
