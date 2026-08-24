import sharp from "sharp";

const DEFAULT_QUALITY = 88;

export type EncodedImage = {
  bytes: Uint8Array;
  contentType: string;
  extension: string;
};

const getQuality = () => {
  const configured = Number(process.env.GENERATED_IMAGE_QUALITY);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_QUALITY;
  }
  return Math.min(Math.max(Math.round(configured), 40), 100);
};

/**
 * OpenAI returns PNG, which for photographic content is roughly ten times the
 * size of an equivalent JPEG. Shopify re-encodes on import anyway, so storing
 * PNG only inflates the blob store. Transparency still forces PNG, since a
 * cut-out on a transparent background would otherwise gain a black backdrop.
 */
export const encodeGeneratedImage = async (bytes: Uint8Array): Promise<EncodedImage> => {
  try {
    const pipeline = sharp(Buffer.from(bytes), { failOn: "none" });
    const metadata = await pipeline.metadata();

    if (metadata.hasAlpha) {
      return { bytes, contentType: "image/png", extension: "png" };
    }

    const encoded = await pipeline.jpeg({ mozjpeg: true, quality: getQuality() }).toBuffer();

    // Only take the re-encode if it actually helped.
    if (encoded.byteLength >= bytes.byteLength) {
      return { bytes, contentType: "image/png", extension: "png" };
    }

    return { bytes: new Uint8Array(encoded), contentType: "image/jpeg", extension: "jpg" };
  } catch {
    // Never fail a generation over an optimisation.
    return { bytes, contentType: "image/png", extension: "png" };
  }
};
