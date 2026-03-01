import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getManifest } from './manifest'
import { handleCatalog } from './catalog'
import { handleMeta } from './meta'
import { handleStream } from './stream'
import { handleProxy } from './proxy'

const app = new Hono()

// Middleware
app.use('*', cors())

// 1. Các Route Proxy (Ưu tiên cao nhất)
// Cấu trúc: /p/v/{hex_url}/{filename}
app.get('/p/i/:hex/:file?', (c) => handleProxy(c)) // Proxy Ảnh
app.get('/p/v/:hex/:file*', (c) => handleProxy(c)) // Proxy Video/M3U8

// 2. Các Route Stremio chuẩn
app.get('/manifest.json', async (c) => c.json(await getManifest()))

app.get('/*', async (c) => {
    const path = decodeURIComponent(c.req.path)
    const origin = new URL(c.req.url).origin

    // Catalog
    if (path.startsWith('/catalog/')) {
        const parts = path.split('/')
        return c.json(await handleCatalog(parts[2], parts[3]?.replace('.json', ''), parts[4]?.replace('.json', ''), origin))
    }

    // Meta
    if (path.startsWith('/meta/')) {
        const parts = path.split('/')
        return c.json(await handleMeta(parts[2], parts[3]?.replace('.json', ''), origin))
    }

    // Stream
    if (path.startsWith('/stream/')) {
        const parts = path.split('/')
        return c.json(await handleStream(parts[2], parts[3]?.replace('.json', ''), origin))
    }

    return c.text('Not Found', 404)
})

export default app
