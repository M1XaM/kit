import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

// The OCR tool runs Tesseract fully offline: the worker, the WASM core and the
// English language data are served by the app itself instead of a CDN. The
// worker fetches them at runtime by URL, so they must keep these exact,
// unhashed paths — they are copied verbatim out of node_modules into dist.
const TESSERACT_ASSETS = {
  'tesseract/worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  'tesseract/tesseract-core-simd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'tesseract/lang/eng.traineddata.gz': 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'
}

const assetContentType = (name) => {
  if (name.endsWith('.js')) return 'text/javascript'
  if (name.endsWith('.gz')) return 'application/gzip'
  return 'application/octet-stream'
}

function tesseractAssets() {
  return {
    name: 'kit-tesseract-assets',
    // Dev server: stream the assets straight from node_modules.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = (req.url || '').split('?')[0].replace(/^\//, '')
        const source = TESSERACT_ASSETS[name]
        if (!source) return next()
        res.setHeader('Content-Type', assetContentType(name))
        createReadStream(path.join(rootDir, source)).pipe(res)
      })
    },
    // Production build: emit the assets into dist under their stable paths.
    generateBundle() {
      for (const [fileName, source] of Object.entries(TESSERACT_ASSETS)) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(path.join(rootDir, source)) })
      }
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tesseractAssets()],
})
