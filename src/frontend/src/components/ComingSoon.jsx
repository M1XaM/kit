import { Link } from 'react-router-dom'

function ComingSoon({ tool }) {
  const Icon = tool.icon
  return (
    <div className="tool-view soon-view">
      <Link to="/" className="back-btn">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back to Tools
      </Link>
      <div className="soon-header">
        <div className={`soon-icon ${tool.colorClass}`}>
          {Icon ? <Icon /> : null}
        </div>
        <span className="soon-pill">Soon</span>
      </div>
      <h2>{tool.title}</h2>
      <p className="soon-highlight">COMING SOON</p>
      <p className="soon-description">{tool.description}</p>
      <p className="soon-subtext">We are actively building this feature and will ship it as soon as possible.</p>
    </div>
  )
}

export default ComingSoon
