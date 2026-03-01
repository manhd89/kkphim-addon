import { KKPHIM_PROXY_KEY, KKPHIM_REFERER } from './utils/key';

// Salted XOR Hex Encoder/Decoder
export const mask = (str: string) => {
    const salt = Math.floor(Math.random() * 256);
    const saltHex = salt.toString(16).padStart(2, '0');
    const encoded = encodeURIComponent(str);
    const masked = Array.from(encoded).map(c => (c.charCodeAt(0) ^ KKPHIM_PROXY_KEY ^ salt).toString(16).padStart(2, '0')).join('');
    return saltHex + masked;
}

const unmask = (hex: string) => {
    try {
        const salt = parseInt(hex.substring(0, 2), 16);
        const data = hex.substring(2);
        let decoded = '';
        for (let i = 0; i < data.length; i += 2) {
            const byte = parseInt(data.substring(i, i + 2), 16);
            decoded += String.fromCharCode(byte ^ KKPHIM_PROXY_KEY ^ salt);
        }
        return decodeURIComponent(decoded);
    } catch { return ''; }
}

const resolveUrl = (base: string, rel: string) => {
    if (rel.startsWith('http')) return rel;
    if (rel.startsWith('//')) return 'https:' + rel;
    try {
        return new URL(rel, base).href;
    } catch {
        return rel;
    }
};

export async function handleProxy(c: any) {
    const hex = c.req.param('hex');
    const pathParts = c.req.path.split('/');
    const type = pathParts[2]; // 'i' hoặc 'v'
    
    const targetUrl = unmask(hex).trim();
    if (!targetUrl) return c.text('Invalid Proxy Token', 400);

    const headers: any = {
        'Referer': KKPHIM_REFERER,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*'
    };

    try {
        const res = await fetch(targetUrl, { headers });
        if (!res.ok) return c.text(`Source Error: ${res.status}`, res.status);

        const contentType = res.headers.get('content-type') || '';
        const isM3U8 = targetUrl.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('application/x-mpegURL');

        // CHẾ ĐỘ 1: Xử lý Playlist (.m3u8)
        if (type === 'v' && isM3U8) {
            let content = await res.text();
            const workerOrigin = new URL(c.req.url).origin;

            const newContent = content.split('\n').map(line => {
                const trimmed = line.trim();
                if (!trimmed) return line;

                // Rewrite các Tag chứa URI (như Key mã hóa)
                if (trimmed.startsWith('#')) {
                    return line.replace(/(URI=")([^"]+)(")/g, (m, p1, p2, p3) => {
                        const abs = resolveUrl(targetUrl, p2);
                        return `${p1}${workerOrigin}/p/v/${mask(abs)}/key.bin${p3}`;
                    });
                }

                // Rewrite đường dẫn Playlist con hoặc Video Segment
                const absoluteUrl = resolveUrl(targetUrl, trimmed);
                const isSubM3U8 = absoluteUrl.includes('.m3u8');
                const suffix = isSubM3U8 ? 'index.m3u8' : 'video.ts';
                
                return `${workerOrigin}/p/v/${mask(absoluteUrl)}/${suffix}`;
            }).join('\n');

            return new Response(newContent, {
                headers: {
                    'Content-Type': 'application/vnd.apple.mpegurl',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-cache'
                }
            });
        }

        // CHẾ ĐỘ 2: Xử lý Binary (Ảnh, .ts, .key)
        // Sử dụng pipe để stream dữ liệu, tiết kiệm RAM cho Worker
        const { readable, writable } = new TransformStream();
        res.body?.pipeTo(writable);

        return new Response(readable, {
            status: res.status,
            headers: {
                'Content-Type': contentType || 'application/octet-stream',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': type === 'i' ? 'public, max-age=2592000' : 'public, max-age=3600'
            }
        });

    } catch (e: any) {
        console.error(`[Proxy] Error: ${e.message}`);
        return c.text(`Proxy Error: ${e.message}`, 500);
    }
}
