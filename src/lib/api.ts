import type {
  AiImageGenerationResult,
  AiImageKind,
  AiImageModel,
  AiProductGenerationResult,
  AiVariantImageResult,
  VariantImageTarget,
} from "../types/ai";
import type { ExtractedProductData } from "../types/product";

const postJson = async <T,>(url: string, payload: unknown): Promise<T> => {
  const response = await fetch(url, {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `Anropet misslyckades (HTTP ${response.status}).`);
  }

  return data as T;
};

export type ImageConfig = {
  hostedImageTtlDays: number;
  hostingConfigured: boolean;
  imageModel: AiImageModel;
};

export const fetchImageConfig = async (): Promise<ImageConfig | null> => {
  try {
    const response = await fetch("/api/image-config");
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as ImageConfig;
  } catch {
    return null;
  }
};

export const requestProductText = (product: ExtractedProductData) =>
  postJson<AiProductGenerationResult>("/api/generate-product", { product });

export type ImageRequest = {
  aiText: AiProductGenerationResult | null;
  imageModel: AiImageModel;
  /** One kind regenerates a single shot; several run a full set. */
  kinds: AiImageKind[];
  product: ExtractedProductData;
  referenceImageFiles: Array<{ dataUrl: string; name: string }>;
  referenceImageUrls: string[];
};

export const requestProductImages = (request: ImageRequest) =>
  postJson<AiImageGenerationResult>("/api/generate-images", request);

export type VariantImageRequest = {
  aiText: AiProductGenerationResult | null;
  baseImageUrl: string;
  imageModel: AiImageModel;
  product: ExtractedProductData;
  targets: VariantImageTarget[];
};

export const requestVariantImages = (request: VariantImageRequest) =>
  postJson<AiVariantImageResult>("/api/generate-variant-images", request);

export const requestHostedImageDeletion =(urls: string[]) =>
  postJson<{ deletedUrls: string[] }>("/api/delete-hosted-images", { urls });

/**
 * Sweeps images past their TTL. Safe to call on every app start: it only ever
 * deletes what has already expired.
 */
export const requestExpiredImageCleanup = () =>
  fetch("/api/cleanup-expired-images", { method: "POST" }).catch(() => undefined);
