function ToolCard({ tool, isFavorite, onToggleFavorite, onNavigate }) {
  const Icon = tool.icon

  return (
    <div className="card" onClick={() => onNavigate(tool.id)}>
      <div className="card-actions">
        {tool.comingSoon && (
          <button
            type="button"
            className="card-soon-pill"
            aria-label={`${tool.title} is coming soon`}
            title="Coming soon"
            onClick={(event) => {
              event.stopPropagation()
              onNavigate(tool.id)
            }}
          >
            Soon
          </button>
        )}
        <button
          type="button"
          className={`favorite-star ${isFavorite ? 'active' : ''}`}
          aria-label={isFavorite ? `Remove ${tool.title} from favorites` : `Add ${tool.title} to favorites`}
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          onClick={(event) => {
            event.stopPropagation()
            onToggleFavorite(tool.id)
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
        </button>
      </div>
      <div className={`card-icon ${tool.colorClass}`}>
        {Icon ? <Icon /> : null}
      </div>
      <h3>{tool.title}</h3>
      <p>{tool.description}</p>
    </div>
  )
}

export default ToolCard
