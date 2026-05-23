import { BrowserRouter } from 'react-router-dom'
import MainLayout from './components/MainLayout'

const HEADER_SUBTITLE = 'The all-in-one toolkit for working with files — directly on your machine.'
const FOOTER_REPO_URL = 'https://github.com/M1XaM/kit'
const FOOTER_AUTHOR_NAME = 'Isacescu Maxim'

function App() {
  return (
    <BrowserRouter>
      <MainLayout
        headerSubtitle={HEADER_SUBTITLE}
        footerRepoUrl={FOOTER_REPO_URL}
        footerAuthorName={FOOTER_AUTHOR_NAME}
      />
    </BrowserRouter>
  )
}

export default App
