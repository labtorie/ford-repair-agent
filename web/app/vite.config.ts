import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

const BUILD = path.resolve(__dirname, '../build')

// Dev only: serve media packs (web/build/packs/<pack>/...) at /packs/<pack>/...
// In production the packs are deployed as separate GitHub Pages sites (see deploy.sh).
function servePacks(): Plugin {
  const types: Record<string, string> = {
    '.gif': 'image/gif', '.jpg': 'image/jpeg', '.pdf': 'application/pdf', '.gz': 'application/gzip',
  }
  return {
    name: 'serve-packs',
    configureServer(server) {
      server.middlewares.use('/packs', (req, res, next) => {
        const file = path.join(BUILD, 'packs', decodeURIComponent((req.url || '').split('?')[0]))
        if (!file.startsWith(path.join(BUILD, 'packs')) || !fs.existsSync(file)) return next()
        res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream')
        fs.createReadStream(file).pipe(res)
      })
    },
  }
}

export default defineConfig({
  base: './',
  publicDir: path.join(BUILD, 'public'),
  plugins: [react(), servePacks()],
  build: { outDir: path.join(BUILD, 'site'), emptyOutDir: true, copyPublicDir: false },
})
