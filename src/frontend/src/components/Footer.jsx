function Footer({ repoUrl, authorName }) {
  if (!repoUrl && !authorName) {
    return null
  }

  return (
    <footer className="footer">
      {repoUrl && (
        <a className="footer-link" href={repoUrl} target="_blank" rel="noreferrer">
          GitHub
        </a>
      )}
      {repoUrl && authorName && <span className="footer-divider">|</span>}
      {authorName && <span className="footer-name">{authorName}</span>}
    </footer>
  )
}

export default Footer
