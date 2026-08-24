import sharp from "sharp";

const DEFAULT_QUALITY = 95;
const MIN_QUALITY = 40;

export type GeneratedImageFormat = "jpeg" | "lossless";

export type EncodedImage = {
  bytes: Uint8Array;
  contentType: string;
  extension: string;
};

export const getGeneratedImageFormat = (): GeneratedImageFormat =>
  process.env.GENERATED_IMAGE_FORMAT === "lossless" ? "lossless" : "jpeg";

const getQuality = () => {
  const configured = Number(process.env.GENERATED_IMAGE_QUALITY);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_QUALITY;
  }
  return Math.min(Math.max(Math.round(configured), MIN_QUALITY), 100);
};

const asPng = (bytes: Uint8Array): EncodedImage => ({ bytes, contentType: "image/png", extension: "png" });

/**
 * OpenAI returns PNG, which for photographic content is many times larger than
 * it needs to be. Shopify accepts JPEG, PNG and WebP and re-encodes everything
 * for delivery anyway, so what is stored here is only the master it downloads.
 *
 * Default is JPEG at quality 95 rather than the more usual 88: a product on a
 * plain background is a hard edge over a flat area, which is exactly where JPEG
 * ringing shows. Measured against the PNG original, 88 leaves a worst-case
 * channel error of 33/255 at those edges while 95 halves it to 16 for about
 * 20% more bytes. Set GENERATED_IMAGE_FORMAT=lossless for WebP lossless, which
 * is a bit-exact copy of what the model produced and still smaller than PNG.
 */
export const encodeGeneratedImage = async (bytes: Uint8Array): Promise<EncodedImage> => {
  try {
    const pipeline = sharp(Buffer.from(bytes), { failOn: "none" });
    const metadata = await pipeline.metadata();

    if (getGeneratedImageFormat() === "lossless") {
      // WebP lossless keeps alpha, so it needs no transparency special case.
      const encoded = await pipeline.webp({ lossless: true }).toBuffer();
      return encoded.byteLength < bytes.byteLength
        ? { bytes: new Uint8Array(encoded), contentType: "image/webp", extension: "webp" }
        : asPng(bytes);
    }

    // Transparency must stay PNG: a cut-out flattened to JPEG gains a black backdrop.
    if (metadata.hasAlpha) {
      return asPng(bytes);
    }

    const encoded = await pipeline.jpeg({ mozjpeg: true, quality: getQuality() }).toBuffer();

    // Only take the re-encode if it actually helped.
    return encoded.byteLength < bytes.byteLength
      ? { bytes: new Uint8Array(encoded), contentType: "image/jpeg", extension: "jpg" }
      : asPng(bytes);
  } catch {
    // Never fail a generation over an optimisation.
    return asPng(bytes);
  }
};
