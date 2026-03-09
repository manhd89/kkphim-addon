import { KKPHIM_PROXY_KEY, KKPHIM_REFERER } from './utils/key';

/**
 * 1. MÃ HÓA URL (MASK)
 */
export const mask = (str: string) => {
    const salt = Math.floor(Math.random() * 256);
    const saltHex = salt.toString(16).padStart(2, '0');
    const encoded = encodeURIComponent(str);
    const masked = Array.from(encoded).map(c => 
        (c.charCodeAt(0) ^ KKPHIM_PROXY_KEY ^ salt).toString(16).padStart(2, '0')
    ).join('');
    return saltHex + masked;
}

/**
 * 2. GIẢI MÃ URL (UNMASK)
 */
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

/**
 * 3. CHUYỂN URL TƯƠNG ĐỐI THÀNH TUYỆT ĐỐI
 */
const resolveUrl = (base: string, rel: string) => {
    if (rel.startsWith('http')) return rel;
    if (rel.startsWith('//')) return 'https:' + rel;
    try {
        return new URL(rel, base).href;
    } catch {
        return rel;
    }
};

/**
 * 4. LÀM SẠCH MANIFEST (XÓA QUẢNG CÁO & FIX PATH)
 * Thực hiện trên nội dung thô (Raw text) từ server gốc
 */
function cleanManifest(manifest: string): string {
    const lines = manifest.split(/\r?\n/);
    const result: string[] = [];

    let i = 0;
    while (i < lines.length) {
        const line = lines[i].trim();

        if (line !== "#EXT-X-DISCONTINUITY") {
            result.push(lines[i]);
            i++;
            continue;
        }

        const start = i;
        let j = i + 1;
        let segments = 0;
        let hasKeyNone = false;

        while (j < lines.length) {
            const l = lines[j].trim();
            if (l.startsWith("#EXTINF:")) segments++;
            if (l.includes("#EXT-X-KEY:METHOD=NONE")) hasKeyNone = true;
            if (l === "#EXT-X-DISCONTINUITY") break;
            j++;
        }

        if (j >= lines.length) {
            result.push(lines[i]);
            i++;
            continue;
        }

        // Logic loại bỏ đoạn quảng cáo
        if (hasKeyNone || (segments >= 5 && segments <= 20)) {
            i = j + 1;
            continue;
        }

        for (let k = start; k <= j; k++) {
            result.push(lines[k]);
        }
        i = j + 1;
    }

    return result.join("\n")
        .replace(/\/convertv7\//g, "/") // Fix lỗi đường dẫn đặc thù của KKPhim
        .replace(/\n{2,}/g, "\n")
        .trim();
}

/**
 * 5. HANDLER CHÍNH
 */
export async function handleProxy(c: any) {
    const hex = c.req.param('hex');
    const pathParts = c.req.path.split('/');
    const type = pathParts[2]; // 'i' (image) hoặc 'v' (video/m3u8)
    
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
        const isM3U8 = targetUrl.includes('.m3u8') || contentType.includes('mpegurl');

        // --- CHẾ ĐỘ 1: Xử lý Playlist (.m3u8) ---
        if (type === 'v' && isM3U8) {
            const rawContent = await res.text();
            const workerOrigin = new URL(c.req.url).origin;

            // BƯỚC A: Làm sạch nội dung gốc trước (Xóa QC, Fix path)
            const cleanedContent = cleanManifest(rawContent);

            // BƯỚC B: Thực hiện Proxy Masking trên nội dung đã sạch
            const finalContent = cleanedContent.split('\n').map(line => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#EXT-X-ENDLIST')) return line;

                // 1. Rewrite các Tag chứa URI (ví dụ: #EXT-X-KEY:METHOD=AES-128,URI="...")
                if (trimmed.startsWith('#')) {
                    return line.replace(/(URI=")([^"]+)(")/g, (m, p1, p2, p3) => {
                        const abs = resolveUrl(targetUrl, p2);
                        return `${p1}${workerOrigin}/p/v/${mask(abs)}/key.bin${p3}`;
                    });
                }

                // 2. Rewrite đường dẫn Video Segment (.ts) hoặc Playlist con
                const absoluteUrl = resolveUrl(targetUrl, trimmed);
                const isSubM3U8 = absoluteUrl.includes('.m3u8');
                const suffix = isSubM3U8 ? 'index.m3u8' : 'video.ts';
                
                return `${workerOrigin}/p/v/${mask(absoluteUrl)}/${suffix}`;
            }).join('\n');

            return new Response(finalContent, {
                headers: {
                    'Content-Type': 'application/vnd.apple.mpegurl',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-cache'
                }
            });
        }

        // --- CHẾ ĐỘ 2: Xử lý Binary (Ảnh, .ts, .key) ---
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
