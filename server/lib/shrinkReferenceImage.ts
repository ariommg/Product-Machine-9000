import sharp from "sharp";
import type { ReferenceImage } from "./referenceImages.js";

const DEFAULT_MAX_EDGE = 768;
const MIN_MAX_EDGE = 256;
const MAX_MAX_EDGE = 2048;

/**
 * Image input is billed on pixel dimensions, and every one of the four image
 * calls re-sends every reference, so an oversized reference is paid for again
 * and again. Marketplace photos are routinely 2000px+ while the model only
 * needs enough resolution to read shape, material, and proportion.
 */
export const getReferenceMaxEdge = () => {
  const configured = Number(process.env.REFERENCE_IMAGE_MAX_EDGE);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_MAX_EDGE;
  }
  return Math.min(Math.max(Math.round(configured), MIN_MAX_EDGE), MAX_MAX_EDGE);
};

export type ShrinkResult = {
  image: ReferenceImage;
  originalEdge: number;
  resizedEdge: number;
};

const extensionFor = (mimeType: string) => (mimeType === "image/png" ? "png" : "jpg");

const withExtension = (fileName: string, extension: string) =>
  `${fileName.replace(/\.[a-z0-9]+$/i, "")}.${extension}`;

/**
 * Never throws. A reference that cannot be resized is sent as-is rather than
 * failing the generation over an optimisation.
 */
export const shrinkReferenceImage = async (image: ReferenceImage, maxEdge: number): Promise<ShrinkResult> => {
  try {
    const pipeline = sharp(Buffer.from(image.bytes), { failOn: "none" }).rotate();
    const metadata = await pipeline.metadata();
    const originalEdge = Math.max(metadata.width ?? 0, metadata.height ?? 0);

    if (originalEdge === 0 || originalEdge <= maxEdge) {
      return { image, originalEdge, resizedEdge: originalEdge };
    }

    const resized = pipeline.resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true });
    // Alpha has to survive: cut-out product shots on transparent backgrounds are common.
    const encoded = metadata.hasAlpha
      ? await resized.png({ compressionLevel: 9 }).toBuffer()
      : await resized.jpeg({ mozjpeg: true, quality: 85 }).toBuffer();

    const mimeType = metadata.hasAlpha ? "image/png" : "image/jpeg";

    return {
      image: {
        bytes: new Uint8Array(encoded),
        fileName: withExtension(image.fileName, extensionFor(mimeType)),
        mimeType,
        url: image.url,
      },
      originalEdge,
      resizedEdge: maxEdge,
    };
  } catch {
    return { image, originalEdge: 0, resizedEdge: 0 };
  }
};

export const shrinkReferenceImages = async (images: ReferenceImage[]) => {
  const maxEdge = getReferenceMaxEdge();
  const results = await Promise.all(images.map((image) => shrinkReferenceImage(image, maxEdge)));

  return {
    images: results.map((result) => result.image),
    resizedCount: results.filter((result) => result.resizedEdge > 0 && result.originalEdge > result.resizedEdge).length,
  };
};
