function Footer({ repoUrl, authorName }) {
  if (!repoUrl && !authorName) {
    return null
  }

  return (
    <footer className="mt-14 flex flex-col items-center gap-2 border-t border-white/10 pt-6 text-center text-sm text-slate-400 md:flex-row md:justify-center md:gap-3">
      {repoUrl && (
        <a className="font-semibold text-blue-400 hover:underline" href={repoUrl} target="_blank" rel="noreferrer">
          GitHub
        </a>
      )}
      {repoUrl && authorName && <span className="text-slate-600">|</span>}
      {authorName && <span className="font-semibold text-slate-200">{authorName}</span>}
    </footer>
  )
}

export default Footer
