import { API_BASE } from './utils/metadata'
import { getSlugFromImdb } from './utils/mapping'
import { mask } from './proxy'
import { KKPHIM_REFERER } from './utils/key'

export async function handleStream(type: string, idRaw: string, origin: string) {
    let slug = '', epSlug = '1'
    if (idRaw.startsWith('kkphim:')) {
        const bits = idRaw.split(':')
        slug = bits[1]
        epSlug = bits[3] || '1'
    } else if (idRaw.startsWith('tt')) {
        const bits = idRaw.split(':')
        const imdbId = bits[0]
        let season = 1
        if (type === 'series') {
            season = parseInt(bits[1]) || 1
            epSlug = bits[2] || '1'
        }

        const mappedSlug = await getSlugFromImdb(imdbId, type, season)
        if (mappedSlug) {
            slug = mappedSlug
        } else {
            return { streams: [] }
        }
    }

    if (!slug) return { streams: [] }

    try {
        console.log(`[Stream] Fetching: slug=${slug}, epSlug=${epSlug}`)
        const res = await fetch(`${API_BASE}/phim/${slug}`, {
            headers: {
                'Referer': KKPHIM_REFERER,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
            }
        })
        const result: any = await res.json()
        // KKPhim V1 details are under result.data.item.episodes
        const episodes = result.data?.item?.episodes || result.episodes || []

        const streams: any[] = []
        episodes.forEach((s: any) => {
            const ep = s.server_data.find((e: any) =>
                e.slug === epSlug ||
                e.name === epSlug ||
                e.name === `Tập ${epSlug}` ||
                e.name === `Tập 0${epSlug}` ||
                (epSlug === '1' && e.name?.toLowerCase() === 'full')
            )

            if (ep?.link_m3u8) {
                streams.push({
                    name: `KKPhim\n${s.server_name}`,
                    title: `${result.movie.name}\n${ep.name} [${result.movie.quality || 'FHD'}]`,
                    url: ep.link_m3u8
                })
            }
        })
        return { streams }
    } catch (e) {
        console.error(`[Stream] Error:`, e)
        return { streams: [] }
    }
}
