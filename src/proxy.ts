// src/proxy.ts
import { KKPHIM_PROXY_KEY, KKPHIM_REFERER } from './utils/key';

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
    return new URL(rel, base).href;
};

export async function handleProxy(c: any) {
    const hex = c.req.param('hex');
    const type = c.req.path.split('/')[2];
    const targetUrl = unmask(hex).trim();

    if (!targetUrl) return c.text('Invalid token', 400);

    const headers = {
        'Referer': KKPHIM_REFERER,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Encoding': 'identity' // Tránh gzip để xử lý text dễ hơn
    };

    try {
        const res = await fetch(targetUrl, { headers });
        if (!res.ok) return c.text('Source Error', res.status);

        // KIỂM TRA NHANH: Nếu là file .ts hoặc ảnh, pipe thẳng luôn (Cực nhẹ CPU)
        const contentType = res.headers.get('content-type') || '';
        const isPlaylist = targetUrl.includes('.m3u8') || contentType.includes('mpegurl');

        if (type !== 'v' || !isPlaylist) {
            const { readable, writable } = new TransformStream();
            res.body?.pipeTo(writable);
            return new Response(readable, {
                status: res.status,
                headers: {
                    'Content-Type': contentType,
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'public, max-age=14400'
                }
            });
        }

        // CHỈ XỬ LÝ M3U8 TẠI ĐÂY
        let content = await res.text();
        const origin = new URL(c.req.url).origin;
        const lines = content.split('\n');
        let output = '';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) {
                output += '\n';
                continue;
            }

            if (line.startsWith('#')) {
                // Chỉ rewrite nếu có URI (Key mã hóa)
                if (line.includes('URI=')) {
                    output += line.replace(/URI="([^"]+)"/, (m, p1) => {
                        return `URI="${origin}/p/v/${mask(resolveUrl(targetUrl, p1))}/key.bin"`;
                    }) + '\n';
                } else {
                    output += line + '\n';
                }
            } else {
                // Line là URL
                const abs = resolveUrl(targetUrl, line);
                const isM3 = abs.includes('.m3u8');
                output += `${origin}/p/v/${mask(abs)}/${isM3 ? 'i.m3u8' : 's.ts'}\n`;
            }
        }

        return new Response(output, {
            headers: {
                'Content-Type': 'application/vnd.apple.mpegurl',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache'
            }
        });

    } catch (e: any) {
        return c.text('Proxy Crash', 500);
    }
}
