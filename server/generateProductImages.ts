import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import OpenAI, { toFile } from "openai";
import { buildImageGenerationPrompt } from "./prompts/imageGenerationPrompt.js";
import {
  MAX_REFERENCE_IMAGE_COUNT,
  fetchReferenceImages,
  parseReferenceImageFiles,
  parseReferenceImageUrls,
  sniffImageMimeType,
} from "./lib/referenceImages.js";
import { encodeGeneratedImage } from "./lib/generatedImages.js";
import { HOSTED_IMAGE_PREFIX } from "./cleanupExpiredImages.js";
import { shrinkReferenceImages } from "./lib/shrinkReferenceImage.js";
import type {
  AiGeneratedImage,
  AiImageGenerationResult,
  AiImageKind,
  AiImageModel,
  AiProductGenerationResult,
} from "../src/types/ai.js";
import type { ExtractedProductData } from "../src/types/product.js";

type GenerateProductImagesInput = {
  aiText: AiProductGenerationResult | null;
  imageModel: unknown;
  /** Which shots to produce. One kind for a regeneration, up to four for a full run. */
  kinds: unknown;
  product: ExtractedProductData;
  referenceImageFiles: unknown;
  referenceImageUrls: unknown;
};

type AiImageQuality = (typeof allowedImageQualities)[number];
type AiImageSize = (typeof allowedImageSizes)[number];

const IMAGE_MODEL_FALLBACK: AiImageModel = "gpt-image-1";
const IMAGE_QUALITY_FALLBACK = "medium";
const IMAGE_SIZE_FALLBACK = "1024x1024";

const allowedImageModels = ["gpt-image-1", "gpt-image-2"] as const;
const allowedImageQualities = ["low", "medium", "high", "auto"] as const;
const allowedImageSizes = ["1024x1024", "1024x1536", "1536x1024", "auto"] as const;

const imageKinds: AiImageKind[] = ["hero", "heroAngled", "macro", "lifestyle"];

const imageLabels: Record<AiImageKind, string> = {
  hero: "Huvudbild",
  heroAngled: "Vinklad bild",
  macro: "Detaljbild",
  lifestyle: "Miljöbild",
};

export const isAllowedImageModel = (model: unknown): model is AiImageModel =>
  typeof model === "string" && allowedImageModels.includes(model as AiImageModel);

const isAllowedImageKind = (kind: unknown): kind is AiImageKind =>
  typeof kind === "string" && imageKinds.includes(kind as AiImageKind);

/** Accepts one kind (regeneration) up to all four (full run), de-duplicated. */
export const parseImageKinds = (kinds: unknown): AiImageKind[] => {
  if (!Array.isArray(kinds) || kinds.length === 0 || !kinds.every(isAllowedImageKind)) {
    throw new Error("Ogiltiga bildtyper. Använd hero, heroAngled, macro eller lifestyle.");
  }

  const unique = Array.from(new Set(kinds as AiImageKind[]));
  // Keep canonical order so a full run always returns hero first.
  return imageKinds.filter((kind) => unique.includes(kind));
};

export const getDefaultImageModel = (): AiImageModel => {
  const envModel = process.env.OPENAI_IMAGE_MODEL;
  return isAllowedImageModel(envModel) ? envModel : IMAGE_MODEL_FALLBACK;
};

const getImageQuality = (): AiImageQuality => {
  const envQuality = process.env.OPENAI_IMAGE_QUALITY;
  if (!envQuality) {
    return IMAGE_QUALITY_FALLBACK;
  }
  if (allowedImageQualities.includes(envQuality as AiImageQuality)) {
    return envQuality as AiImageQuality;
  }
  throw new Error(`Ogiltig OPENAI_IMAGE_QUALITY "${envQuality}". Använd low, medium, high eller auto.`);
};

const getImageSize = (): AiImageSize => {
  const envSize = process.env.OPENAI_IMAGE_SIZE;
  if (!envSize) {
    return IMAGE_SIZE_FALLBACK;
  }
  if (allowedImageSizes.includes(envSize as AiImageSize)) {
    return envSize as AiImageSize;
  }
  throw new Error(`Ogiltig OPENAI_IMAGE_SIZE "${envSize}". Använd 1024x1024, 1024x1536, 1536x1024 eller auto.`);
};

type GeneratedImageAsset = {
  bytes: Uint8Array | null;
  contentType: string;
  dataUrlOrUrl: string;
};

const imageToGeneratedAsset = async (image: { b64_json?: string; url?: string }): Promise<GeneratedImageAsset> => {
  if (image.b64_json) {
    const bytes = new Uint8Array(Buffer.from(image.b64_json, "base64"));
    const contentType = sniffImageMimeType(bytes) || "image/png";
    return { bytes, contentType, dataUrlOrUrl: `data:${contentType};base64,${image.b64_json}` };
  }

  if (image.url) {
    const response = await fetch(image.url);
    if (!response.ok) {
      return { bytes: null, contentType: "", dataUrlOrUrl: image.url };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType =
      sniffImageMimeType(bytes) || response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
    return { bytes, contentType, dataUrlOrUrl: image.url };
  }

  throw new Error("Bildgenereringen returnerade ingen bilddata.");
};

/**
 * Shopify imports images by downloading them, so a generated image is only usable
 * once it has a public URL. Without a blob token it stays preview-only.
 */
const uploadGeneratedImageToBlob = async (kind: AiImageKind, asset: GeneratedImageAsset) => {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return {
      blobPathname: null,
      hostedUrl: null,
      hostingError: "BLOB_READ_WRITE_TOKEN saknas. Bilden kan förhandsgranskas men inte exporteras till Shopify.",
    };
  }

  if (!asset.bytes || !asset.contentType) {
    return { blobPathname: null, hostedUrl: null, hostingError: "Bilddatan gick inte att läsa för uppladdning." };
  }

  try {
    // Re-encode before upload: this is what is stored, and what Shopify downloads.
    const encoded = await encodeGeneratedImage(asset.bytes);
    const blob = await put(
      `${HOSTED_IMAGE_PREFIX}${Date.now()}-${randomUUID()}-${kind}.${encoded.extension}`,
      Buffer.from(encoded.bytes),
      { access: "public", addRandomSuffix: false, contentType: encoded.contentType },
    );

    return { blobPathname: blob.pathname, hostedUrl: blob.url, hostingError: null };
  } catch (error) {
    return {
      blobPathname: null,
      hostedUrl: null,
      hostingError: error instanceof Error ? `Uppladdning misslyckades: ${error.message}` : "Uppladdning misslyckades.",
    };
  }
};

export const generateProductImages = async ({
  aiText,
  imageModel,
  kinds,
  product,
  referenceImageFiles,
  referenceImageUrls,
}: GenerateProductImagesInput): Promise<AiImageGenerationResult> => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY saknas.");
  }
  if (!isAllowedImageModel(imageModel)) {
    throw new Error("Ogiltig bildmodell. Använd gpt-image-1 eller gpt-image-2.");
  }

  const requestedKinds = parseImageKinds(kinds);
  const imageQuality = getImageQuality();
  const imageSize = getImageSize();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const selectedReferenceImageUrls = parseReferenceImageUrls(referenceImageUrls);
  const { failedFileCount, userReferenceImages } = parseReferenceImageFiles(referenceImageFiles);

  if (failedFileCount > 0) {
    throw new Error(
      `${failedFileCount} egen referensbild kunde inte läsas. Använd PNG, JPG eller WebP under 50 MB.`,
    );
  }
  if (selectedReferenceImageUrls.length + userReferenceImages.length > MAX_REFERENCE_IMAGE_COUNT) {
    throw new Error(`För många referensbilder. Högst ${MAX_REFERENCE_IMAGE_COUNT} stöds.`);
  }

  const { failures, referenceImages } = await fetchReferenceImages(selectedReferenceImageUrls);
  const allReferenceImages = [...referenceImages, ...userReferenceImages];

  // A reference that cannot be downloaded is reported, not fatal. Generation runs
  // with whatever did load so one dead CDN URL cannot block the whole product.
  if (failures.length > 0 && allReferenceImages.length === 0) {
    throw new Error(
      `Ingen av de valda referensbilderna kunde hämtas: ${failures
        .map((failure) => failure.reason)
        .join("; ")}. Klistra in bilden manuellt eller välj en annan källbild.`,
    );
  }

  // Shrink once, before the fan-out: every image call re-sends every reference,
  // so the saving is multiplied by the number of images being generated.
  const { images: sizedReferenceImages } = await shrinkReferenceImages(allReferenceImages);

  const referenceFiles = await Promise.all(
    sizedReferenceImages.map((referenceImage) =>
      toFile(referenceImage.bytes, referenceImage.fileName, { type: referenceImage.mimeType }),
    ),
  );

  const entries = await Promise.all(
    requestedKinds.map(async (kind): Promise<[AiImageKind, AiGeneratedImage]> => {
      const prompt = buildImageGenerationPrompt(kind, product, aiText);
      const response =
        referenceFiles.length > 0
          ? await client.images.edit({
              image: referenceFiles,
              model: imageModel,
              n: 1,
              prompt,
              quality: imageQuality,
              size: imageSize,
            })
          : await client.images.generate({
              model: imageModel,
              n: 1,
              prompt,
              quality: imageQuality,
              size: imageSize,
            });

      const image = response.data?.[0];
      if (!image) {
        throw new Error(`Bildgenereringen returnerade ingen ${imageLabels[kind].toLowerCase()}.`);
      }

      const asset = await imageToGeneratedAsset(image);
      const hosting = await uploadGeneratedImageToBlob(kind, asset);

      return [
        kind,
        {
          blobPathname: hosting.blobPathname,
          dataUrlOrUrl: asset.dataUrlOrUrl,
          hostedUrl: hosting.hostedUrl,
          hostingError: hosting.hostingError,
          label: imageLabels[kind],
        },
      ];
    }),
  );

  return {
    failedReferences: failures,
    generatedKinds: requestedKinds,
    images: Object.fromEntries(entries) as AiImageGenerationResult["images"],
    referenceImageUrls: allReferenceImages.map((referenceImage) => referenceImage.url),
    usedReferenceImage: allReferenceImages.length > 0,
  };
};
