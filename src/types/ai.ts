export type AiSpecConfidence = "high" | "medium" | "low";

export type AiGeneratedSpec = {
  confidence: AiSpecConfidence;
  name: string;
  value: string;
};

export type AiProductGenerationResult = {
  description: string;
  needsReview: string[];
  specs: AiGeneratedSpec[];
  title: string;
  /** Fields that tripped the internal-wording filter and must be read before approval. */
  warnings: string[];
};

export type AiGeneratedImage = {
  blobPathname: string | null;
  dataUrlOrUrl: string;
  hostedUrl: string | null;
  hostingError: string | null;
  label: string;
};

export type AiImageModel = "gpt-image-1" | "gpt-image-2";
export type AiImageCount = 1 | 2 | 3 | 4;
export type AiImageKind = "hero" | "heroAngled" | "macro" | "lifestyle";

export type ReferenceImageFailure = {
  reason: string;
  url: string;
};

export type AiImageGenerationResult = {
  /** References the server could not load. Generation still runs with whatever loaded. */
  failedReferences: ReferenceImageFailure[];
  /** Which kinds this run produced. A regeneration returns exactly one. */
  generatedKinds: AiImageKind[];
  images: Partial<Record<AiImageKind, AiGeneratedImage>>;
  referenceImageUrls: string[];
  usedReferenceImage: boolean;
};

export const AI_IMAGE_KINDS: AiImageKind[] = ["hero", "heroAngled", "macro", "lifestyle"];

export const imageKindsForCount = (imageCount: AiImageCount) => AI_IMAGE_KINDS.slice(0, imageCount);
