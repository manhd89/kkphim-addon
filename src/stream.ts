import { API_BASE } from "./utils/metadata";
import { getSlugFromImdb } from "./utils/mapping";
import { mask } from "./proxy";
import { KKPHIM_REFERER } from "./utils/key";

export async function handleStream(type: string, idRaw: string, origin: string) {
  let slug = "";
  let epSlug = "1";

  /**
   * kkphim id
   */
  if (idRaw.startsWith("kkphim:")) {
    const bits = idRaw.split(":");
    slug = bits[1];
    epSlug = bits[3] || "1";
  }

  /**
   * imdb id
   */
  else if (idRaw.startsWith("tt")) {
    const bits = idRaw.split(":");
    const imdbId = bits[0];

    let season = 1;

    if (type === "series") {
      season = parseInt(bits[1]) || 1;
      epSlug = bits[2] || "1";
    }

    const mappedSlug = await getSlugFromImdb(imdbId, type, season);

    if (mappedSlug) {
      slug = mappedSlug;
    } else {
      return { streams: [] };
    }
  }

  if (!slug) return { streams: [] };

  try {
    console.log(`[Stream] Fetching: slug=${slug}, epSlug=${epSlug}`);

    const res = await fetch(`${API_BASE}/phim/${slug}`, {
      headers: {
        Referer: KKPHIM_REFERER,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      },
    });

    const result: any = await res.json();

    const item = result.data?.item || {};
    const episodes = item.episodes || result.episodes || [];

    const streams: any[] = [];

    episodes.forEach((server: any) => {
      const ep = server.server_data.find((e: any) => {
        const name = e.name?.toLowerCase() || "";

        return (
          e.slug === epSlug ||
          e.name === epSlug ||
          name === `tập ${epSlug}` ||
          name === `tập 0${epSlug}` ||
          (epSlug === "1" && name === "full")
        );
      });

      if (ep?.link_m3u8) {
        const proxied = `${origin}/p/v/${mask(ep.link_m3u8)}/index.m3u8`;

        streams.push({
          name: `KKPhim\n${server.server_name}`,
          title: `${item.name || slug}\n${ep.name} [${item.quality || "FHD"}]`,
          url: proxied,
        });
      }
    });

    return { streams };
  } catch (e) {
    console.error("[Stream] Error:", e);
    return { streams: [] };
  }
} 
