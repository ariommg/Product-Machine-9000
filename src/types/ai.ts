export type AiSpecConfidence = "high" | "medium" | "low";

export type AiGeneratedSpec = {
  confidence: AiSpecConfidence;
  name: string;
  value: string;
};

export type AiOptionName = {
  id: string;
  name: string;
  values: Array<{ id: string; name: string }>;
};

export type AiProductGenerationResult = {
  description: string;
  needsReview: string[];
  /** Swedish names for the variant options and their values, keyed by supplier id. */
  options: AiOptionName[];
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

/** One extra colour to render as a hero matching the main colour's hero. */
export type VariantImageTarget = {
  name: string;
  /** A user-supplied reference, used instead of the supplier swatch when set. */
  referenceFile: { dataUrl: string; name: string } | null;
  referenceUrl: string;
  valueId: string;
};

export type VariantImageFailure = {
  reason: string;
  valueId: string;
};

export type AiVariantImageResult = {
  failures: VariantImageFailure[];
  images: Record<string, AiGeneratedImage>;
};

export const AI_IMAGE_KINDS: AiImageKind[] = ["hero", "heroAngled", "macro", "lifestyle"];

export const imageKindsForCount = (imageCount: AiImageCount) => AI_IMAGE_KINDS.slice(0, imageCount);
