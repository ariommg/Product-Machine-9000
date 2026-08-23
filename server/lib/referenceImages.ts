export type ReferenceImage = {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  url: string;
};

export type ReferenceImageFailure = {
  reason: string;
  url: string;
};

/** OpenAI's image edit endpoint accepts these. Anything else has to be rejected. */
const SUPPORTED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export const MAX_REFERENCE_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_REFERENCE_IMAGE_COUNT = 16;

const FETCH_TIMEOUT_MS = 20000;
const FETCH_ATTEMPTS = 3;
const RETRY_DELAY_MS = 400;

/**
 * Marketplace CDNs serve images only to what looks like a real browser tab.
 * A bot-shaped User-Agent with no Referer is refused outright, which is why
 * selecting a source image used to fail while pasting the same image worked.
 */
const browserHeaders = (imageUrl: URL) => ({
  Accept: "image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5",
  "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8",
  Referer: refererFor(imageUrl),
  "Sec-Fetch-Dest": "image",
  "Sec-Fetch-Mode": "no-cors",
  "Sec-Fetch-Site": "cross-site",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
});

const refererFor = (imageUrl: URL) => {
  const host = imageUrl.hostname.toLowerCase();
  if (host.endsWith("alicdn.com") || host.endsWith("alibaba.com")) {
    return "https://www.alibaba.com/";
  }
  return `${imageUrl.protocol}//${imageUrl.hostname}/`;
};

export const normalizeReferenceUrl = (url: string) => {
  const trimmed = url.trim().replace(/\\\//g, "/");
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
};

/**
 * Alibaba appends format and resize markers to the real file name, so the same
 * image is often reachable as a plain JPEG once those are stripped. Trying the
 * variants costs one extra request and rescues most otherwise-dead URLs.
 */
const urlVariants = (url: string) => {
  const variants = [url];

  const withoutFormatSuffix = url.replace(/\.(webp|avif|png|jpg|jpeg)_?\.(webp|avif)$/i, ".$1");
  if (withoutFormatSuffix !== url) {
    variants.push(withoutFormatSuffix);
  }

  const withoutTrailingMarker = url.replace(/_\.(webp|avif)$/i, "");
  if (withoutTrailingMarker !== url) {
    variants.push(withoutTrailingMarker);
  }

  const withoutQuery = url.split("?")[0];
  if (withoutQuery && withoutQuery !== url) {
    variants.push(withoutQuery);
  }

  const withoutResize = withoutQuery.replace(/_\d+x\d+(q\d+)?\.(jpg|jpeg|png|webp)$/i, "");
  if (withoutResize && withoutResize !== withoutQuery && /\.(jpg|jpeg|png|webp)$/i.test(withoutResize)) {
    variants.push(withoutResize);
  }

  return Array.from(new Set(variants));
};

/**
 * CDNs frequently send application/octet-stream or no content type at all, so the
 * header alone is not enough to decide whether the bytes are a usable image.
 */
export const sniffImageMimeType = (bytes: Uint8Array) => {
  if (bytes.length < 12) {
    return "";
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const ascii = String.fromCharCode(...bytes.subarray(0, 12));
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") {
    return "image/webp";
  }
  if (ascii.startsWith("GIF8")) {
    return "image/gif";
  }
  if (ascii.slice(4, 8) === "ftyp" && /avif|avis/i.test(ascii.slice(8, 12))) {
    return "image/avif";
  }
  return "";
};

const extensionForMimeType = (mimeType: string) => {
  if (mimeType === "image/png") {
    return "png";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  return "jpg";
};

const humanReason = (mimeType: string) => {
  if (mimeType === "image/avif") {
    return "bilden levererades i AVIF-format som bildmodellen inte stödjer";
  }
  if (mimeType === "image/gif") {
    return "bilden levererades som GIF som bildmodellen inte stödjer";
  }
  return "innehållet var inte en bild som stöds (PNG, JPG eller WebP)";
};

type FetchAttempt = { image: ReferenceImage } | { reason: string };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Image CDNs drop connections under bursts, so a reset is retried rather than
 * reported as a dead URL. Requests are also issued one at a time by the caller
 * for the same reason.
 */
const fetchWithRetry = async (parsedUrl: URL): Promise<{ response: Response } | { reason: string }> => {
  let lastReason = "servern gick inte att nå";

  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await wait(RETRY_DELAY_MS * attempt);
    }

    try {
      return {
        response: await fetch(parsedUrl, {
          headers: browserHeaders(parsedUrl),
          redirect: "follow",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        }),
      };
    } catch (error) {
      lastReason =
        error instanceof Error && error.name === "TimeoutError"
          ? "servern svarade inte i tid"
          : "servern gick inte att nå";
    }
  }

  return { reason: lastReason };
};

const attemptFetch = async (candidateUrl: string, originalUrl: string, index: number): Promise<FetchAttempt> => {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(candidateUrl);
  } catch {
    return { reason: "adressen kunde inte tolkas" };
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return { reason: "adressen är inte en http- eller https-adress" };
  }

  const attempt = await fetchWithRetry(parsedUrl);
  if ("reason" in attempt) {
    return attempt;
  }
  const { response } = attempt;

  if (!response.ok) {
    return {
      reason:
        response.status === 403 || response.status === 401
          ? `åtkomst nekades (HTTP ${response.status}), troligen hotlink-skydd`
          : `servern svarade HTTP ${response.status}`,
    };
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (bytes.byteLength === 0) {
    return { reason: "svaret var tomt" };
  }
  if (bytes.byteLength > MAX_REFERENCE_IMAGE_BYTES) {
    return { reason: "bilden är större än 50 MB" };
  }

  const headerMimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  const sniffedMimeType = sniffImageMimeType(bytes);
  // Sniffed bytes win: the header is wrong far more often than the file is.
  const mimeType = SUPPORTED_MIME_TYPES.has(sniffedMimeType)
    ? sniffedMimeType
    : SUPPORTED_MIME_TYPES.has(headerMimeType)
      ? headerMimeType
      : "";

  if (!mimeType) {
    return { reason: humanReason(sniffedMimeType || headerMimeType) };
  }

  return {
    image: {
      bytes,
      fileName: `kallbild-${index + 1}.${extensionForMimeType(mimeType)}`,
      mimeType,
      url: originalUrl,
    },
  };
};

/** Tries each URL variant in turn and reports why the last one failed. */
export const fetchReferenceImage = async (url: string, index: number): Promise<FetchAttempt> => {
  const normalizedUrl = normalizeReferenceUrl(url);
  if (!normalizedUrl) {
    return { reason: "tom adress" };
  }

  let lastReason = "okänt fel";
  for (const candidateUrl of urlVariants(normalizedUrl)) {
    const attempt = await attemptFetch(candidateUrl, normalizedUrl, index);
    if ("image" in attempt) {
      return attempt;
    }
    lastReason = attempt.reason;
  }

  return { reason: lastReason };
};

/**
 * Sequential on purpose. Firing these in parallel makes image CDNs reset the
 * connections, which looked exactly like the URLs being dead.
 */
export const fetchReferenceImages = async (urls: string[]) => {
  const referenceImages: ReferenceImage[] = [];
  const failures: ReferenceImageFailure[] = [];

  for (const [index, url] of urls.entries()) {
    const attempt = await fetchReferenceImage(url, index);
    if ("image" in attempt) {
      referenceImages.push(attempt.image);
    } else {
      failures.push({ reason: attempt.reason, url });
    }
  }

  return { failures, referenceImages };
};

type ReferenceImageFilePayload = {
  dataUrl: string;
  name?: string;
};

const isReferenceImageFilePayload = (value: unknown): value is ReferenceImageFilePayload =>
  typeof value === "object" && value !== null && typeof (value as ReferenceImageFilePayload).dataUrl === "string";

export const parseReferenceImageFiles = (referenceImageFiles: unknown) => {
  if (!Array.isArray(referenceImageFiles)) {
    return { failedFileCount: 0, userReferenceImages: [] as ReferenceImage[] };
  }

  let failedFileCount = 0;
  const userReferenceImages: ReferenceImage[] = [];

  referenceImageFiles.forEach((payload, index) => {
    if (!isReferenceImageFilePayload(payload)) {
      failedFileCount += 1;
      return;
    }

    const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(payload.dataUrl.trim());
    if (!match) {
      failedFileCount += 1;
      return;
    }

    const bytes = new Uint8Array(Buffer.from(match[2], "base64"));
    const sniffedMimeType = sniffImageMimeType(bytes);
    const mimeType = SUPPORTED_MIME_TYPES.has(sniffedMimeType) ? sniffedMimeType : match[1].toLowerCase();

    if (!SUPPORTED_MIME_TYPES.has(mimeType) || bytes.byteLength === 0 || bytes.byteLength > MAX_REFERENCE_IMAGE_BYTES) {
      failedFileCount += 1;
      return;
    }

    const cleanName = typeof payload.name === "string" ? payload.name.replace(/[^a-z0-9._-]+/gi, "-") : "";
    userReferenceImages.push({
      bytes,
      fileName: cleanName || `egen-referens-${index + 1}.${extensionForMimeType(mimeType)}`,
      mimeType,
      url: cleanName || `egen-referens-${index + 1}`,
    });
  });

  return { failedFileCount, userReferenceImages };
};

export const parseReferenceImageUrls = (referenceImageUrls: unknown) => {
  if (!Array.isArray(referenceImageUrls)) {
    return [];
  }

  return Array.from(
    new Set(
      referenceImageUrls
        .filter((url): url is string => typeof url === "string")
        .map(normalizeReferenceUrl)
        .filter(Boolean),
    ),
  );
};
