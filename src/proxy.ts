import { KKPHIM_PROXY_KEY, KKPHIM_REFERER } from "./utils/key";

/**
 * 1. MASK URL
 */
export const mask = (str: string) => {
  const salt = Math.floor(Math.random() * 256);
  const saltHex = salt.toString(16).padStart(2, "0");

  const encoded = encodeURIComponent(str);

  const masked = Array.from(encoded)
    .map((c) =>
      (c.charCodeAt(0) ^ KKPHIM_PROXY_KEY ^ salt)
        .toString(16)
        .padStart(2, "0")
    )
    .join("");

  return saltHex + masked;
};

/**
 * 2. UNMASK
 */
const unmask = (hex: string) => {
  try {
    const salt = parseInt(hex.substring(0, 2), 16);
    const data = hex.substring(2);

    let decoded = "";

    for (let i = 0; i < data.length; i += 2) {
      const byte = parseInt(data.substring(i, i + 2), 16);
      decoded += String.fromCharCode(byte ^ KKPHIM_PROXY_KEY ^ salt);
    }

    return decodeURIComponent(decoded);
  } catch {
    return "";
  }
};

/**
 * 3. RESOLVE RELATIVE URL
 */
const resolveUrl = (base: string, rel: string) => {
  if (rel.startsWith("http")) return rel;
  if (rel.startsWith("//")) return "https:" + rel;

  try {
    return new URL(rel, base).href;
  } catch {
    return rel;
  }
};

/**
 * 4. CLEAN MANIFEST
 */
function cleanManifest(manifest: string) {
  const lines = manifest.split(/\r?\n/);
  const result: string[] = [];

  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (line === "#EXT-X-DISCONTINUITY") {
      let j = i + 1;
      let segments = 0;

      while (j < lines.length) {
        const l = lines[j].trim();

        if (l.startsWith("#EXTINF")) segments++;
        if (l === "#EXT-X-DISCONTINUITY") break;

        j++;
      }

      // quảng cáo thường <5 segment
      if (segments > 0 && segments < 5) {
        i = j;
        continue;
      }
    }

    result.push(lines[i]);
    i++;
  }

  return result
    .join("\n")
    .replace(/\/convertv7\//g, "/")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * 5. REWRITE PLAYLIST
 */
function rewriteManifest(
  manifest: string,
  baseUrl: string,
  workerOrigin: string
) {
  const lines = manifest.split("\n");

  return lines
    .map((line) => {
      const trimmed = line.trim();

      if (!trimmed) return line;

      /**
       * rewrite KEY URI
       */
      if (trimmed.startsWith("#EXT-X-KEY")) {
        return line.replace(/URI="([^"]+)"/g, (_, uri) => {
          const abs = resolveUrl(baseUrl, uri);
          return `URI="${workerOrigin}/p/v/${mask(abs)}/key.bin"`;
        });
      }

      /**
       * rewrite other tags containing URI
       */
      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_, uri) => {
          const abs = resolveUrl(baseUrl, uri);
          return `URI="${workerOrigin}/p/v/${mask(abs)}/index.m3u8"`;
        });
      }

      /**
       * rewrite segment / sub playlist
       */
      const absoluteUrl = resolveUrl(baseUrl, trimmed);

      const isSub = absoluteUrl.includes(".m3u8");

      const suffix = isSub ? "index.m3u8" : "video.ts";

      return `${workerOrigin}/p/v/${mask(absoluteUrl)}/${suffix}`;
    })
    .join("\n");
}

/**
 * 6. MAIN PROXY
 */
export async function handleProxy(c: any) {
  const hex = c.req.param("hex");

  const pathParts = c.req.path.split("/");
  const type = pathParts[2];

  const targetUrl = unmask(hex).trim();

  if (!targetUrl) return c.text("Invalid Proxy Token", 400);

  const headers: any = {
    Referer: KKPHIM_REFERER,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    Accept: "*/*",
  };

  try {
    const res = await fetch(targetUrl, { headers });

    if (!res.ok)
      return c.text(`Source Error: ${res.status}`, res.status);

    const contentType = res.headers.get("content-type") || "";

    const isM3U8 =
      targetUrl.includes(".m3u8") ||
      contentType.includes("mpegurl");

    /**
     * PLAYLIST MODE
     */
    if (type === "v" && isM3U8) {
      const rawContent = await res.text();

      const workerOrigin = new URL(c.req.url).origin;

      // CLEAN BEFORE MASK
      const cleaned = cleanManifest(rawContent);

      // REWRITE AFTER CLEAN
      const finalContent = rewriteManifest(
        cleaned,
        targetUrl,
        workerOrigin
      );

      return new Response(finalContent, {
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache",
        },
      });
    }

    /**
     * BINARY MODE
     */
    const { readable, writable } = new TransformStream();

    res.body?.pipeTo(writable);

    return new Response(readable, {
      status: res.status,
      headers: {
        "Content-Type":
          contentType || "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control":
          type === "i"
            ? "public, max-age=2592000"
            : "public, max-age=3600",
      },
    });
  } catch (e: any) {
    console.error("[Proxy] Error:", e.message);

    return c.text(`Proxy Error: ${e.message}`, 500);
  }
}
