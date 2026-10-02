import { buildSeoDescription, buildSeoTitle, cleanProductTitle, slugify } from "../lib/productFormatting";
import type { AiImageKind } from "../types/ai";
import type { DraftVariant, ExtractedProductData, ProductDraft, ProductSpecification } from "../types/product";

export type ReviewStatus = "verified" | "needs-review" | "missing";

export type ReviewTextFieldKey = "title" | "description";

export type ReviewTextField = {
  approved: boolean;
  key: ReviewTextFieldKey;
  label: string;
  source: string;
  status: ReviewStatus;
  value: string;
};

export type ReviewSpecificationField = {
  approved: boolean;
  id: string;
  manual: boolean;
  name: string;
  source: string;
  value: string;
};

export type ReviewImageField = {
  approved: boolean;
  blobPathname: string | null;
  hostedUrl: string | null;
  hostingError: string | null;
  /** Which of the four shot types this is, so a single one can be regenerated. */
  imageKind: AiImageKind | null;
  /** Source images are reference-only. Only generated images can reach Shopify. */
  kind: "source" | "ai-generated";
  label: string;
  url: string;
  /** The colour this image shows, when the product has a visual option. */
  variantValueId: string | null;
  /** A single hero for an extra colour, as opposed to the main colour's full set. */
  variantHero: boolean;
};

export type ReferenceFile = { dataUrl: string; name: string };

export type ReviewVariantValue = {
  approved: boolean;
  /** A pasted reference that replaces the supplier swatch for image generation. */
  customReference: ReferenceFile | null;
  hexColor: string;
  id: string;
  imageUrl: string;
  /** Swedish name, which is what reaches Shopify. */
  name: string;
  supplierName: string;
  thumbnailUrl: string;
};

export type ReviewVariantOption = {
  /** Approval of the Swedish group name. Values are approved one by one. */
  approved: boolean;
  id: string;
  name: string;
  supplierName: string;
  values: ReviewVariantValue[];
  visual: boolean;
};

export type ProductReviewState = {
  fields: ReviewTextField[];
  images: ReviewImageField[];
  /** The colour that gets the full image set. Every other colour gets one hero. */
  mainVariantValueId: string;
  rawData: ExtractedProductData;
  specifications: ReviewSpecificationField[];
  variants: ReviewVariantOption[];
};

/** Shopify allows three options per product. */
export const MAX_SHOPIFY_OPTIONS = 3;
/** Shopify's per-product variant limit. */
export const MAX_SHOPIFY_VARIANTS = 2048;

let specificationCounter = 0;
const nextSpecificationId = () => {
  specificationCounter += 1;
  return `spec-${specificationCounter}`;
};

/**
 * Supplier, logistics, and marketplace bookkeeping must never reach customer-facing
 * specs. These are filtered out on import and again on export.
 */
const blockedSpecificationPatterns = [
  /place of origin/i,
  /country of origin/i,
  /\borigin\b/i,
  /ursprung/i,
  /\bmoq\b/i,
  /minimum order/i,
  /minsta best[aä]llning/i,
  /model number/i,
  /modellnummer/i,
  /item number/i,
  /artikelnummer/i,
  /supplier|leverant[oö]r/i,
  /\bsku\b/i,
  /package|paket|carton|kartong/i,
  /unit (size|weight|dimension)/i,
  /shipping|frakt|logistic|logistik/i,
  /lead time|leveranstid/i,
  /payment|betalning/i,
  /port\b/i,
  /brand name|varum[aä]rke/i,
  /warranty|garanti/i,
  /after-?sales/i,
  /\bcertificat|\bcertifiering/i,
];

export const isBlockedSpecification = (specification: Pick<ReviewSpecificationField, "name" | "value">) =>
  blockedSpecificationPatterns.some((pattern) => pattern.test(`${specification.name} ${specification.value}`));

/** Placeholder values suppliers use when they have not filled the field in. */
const isUsefulSpecificationValue = (value: string) => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return ![/^customi[sz]ed(\s+size)?$/, /^custom(\s+size)?$/, /^n\/?a$/, /^none$/, /^unknown$/, /^-+$/].some(
    (pattern) => pattern.test(normalized),
  );
};

/** Rows worth having on every product regardless of category. */
const defaultSpecificationRows: Array<{ name: string; patterns: RegExp[] }> = [
  { name: "Storlek", patterns: [/storlek/i, /^size$/i, /dimension/i, /m[aå]tt/i, /l[aä]ngd/i, /diameter/i] },
  { name: "Material", patterns: [/material/i] },
  { name: "Vikt", patterns: [/vikt/i, /weight/i] },
  { name: "Innehåll / antal", patterns: [/inneh[aå]ll/i, /antal/i, /quantity/i, /pieces/i, /pcs/i, /\bset\b/i] },
];

const specificationPriority = (name: string) => {
  const lowerName = name.toLowerCase();
  if (/storlek|^m[aå]tt$|dimension|l[aä]ngd|diameter/.test(lowerName)) {
    return 0;
  }
  if (/material/.test(lowerName)) {
    return 1;
  }
  if (/vikt|weight/.test(lowerName)) {
    return 2;
  }
  return 3;
};

const sortSpecifications = (specifications: ReviewSpecificationField[]) =>
  specifications
    .map((specification, index) => ({ index, specification }))
    .sort(
      (left, right) =>
        specificationPriority(left.specification.name) - specificationPriority(right.specification.name) ||
        left.index - right.index,
    )
    .map((item) => item.specification);

export const createManualSpecification = (): ReviewSpecificationField => ({
  approved: false,
  id: nextSpecificationId(),
  manual: true,
  name: "",
  source: "manuellt tillagd",
  value: "",
});

const buildSpecificationFields = (specifications: ProductSpecification[]) => {
  const extracted = specifications
    .filter((specification) => !isBlockedSpecification(specification))
    .map(
      (specification): ReviewSpecificationField => ({
        approved: false,
        id: nextSpecificationId(),
        manual: false,
        name: specification.name,
        source: specification.source ?? "produktdata",
        value: specification.value,
      }),
    );

  const missingDefaults = defaultSpecificationRows
    .filter(
      (defaultRow) =>
        !extracted.some(
          (specification) =>
            defaultRow.patterns.some((pattern) => pattern.test(specification.name)) &&
            isUsefulSpecificationValue(specification.value),
        ),
    )
    .map((defaultRow) => ({ ...createManualSpecification(), name: defaultRow.name }));

  return sortSpecifications([...extracted, ...missingDefaults]);
};

const statusForValue = (value: string): ReviewStatus => (value.trim() ? "needs-review" : "missing");

export const buildReviewState = (rawData: ExtractedProductData): ProductReviewState => ({
  fields: [
    {
      approved: false,
      key: "title",
      label: "Produkttitel",
      source: "product.subject",
      status: statusForValue(rawData.title),
      value: cleanProductTitle(rawData.title),
    },
    {
      approved: false,
      key: "description",
      label: "Produktbeskrivning",
      source: "product.description",
      status: statusForValue(rawData.description),
      value: rawData.description,
    },
  ],
  images: rawData.imageUrls.map((url, index) => ({
    approved: false,
    blobPathname: null,
    hostedUrl: null,
    hostingError: null,
    imageKind: null,
    kind: "source",
    label: `Källbild ${index + 1}`,
    url,
    variantValueId: null,
    variantHero: false,
  })),
  mainVariantValueId: rawData.variantOptions.find((option) => option.visual)?.values[0]?.id ?? "",
  rawData,
  specifications: buildSpecificationFields(rawData.specifications),
  // Nothing is approved up front: the supplier often lists far more colours than you want to sell.
  variants: rawData.variantOptions.map((option) => ({
    approved: false,
    id: option.id,
    name: option.name,
    supplierName: option.name,
    values: option.values.map((value) => ({
      approved: false,
      customReference: null,
      hexColor: value.hexColor,
      id: value.id,
      imageUrl: value.imageUrl,
      name: value.name,
      supplierName: value.name,
      thumbnailUrl: value.thumbnailUrl,
    })),
    visual: option.visual,
  })),
});

export const visualOption = (reviewState: ProductReviewState) =>
  reviewState.variants.find((option) => option.visual) ?? null;

export const mainVariantValue = (reviewState: ProductReviewState) =>
  visualOption(reviewState)?.values.find((value) => value.id === reviewState.mainVariantValueId) ?? null;

/** What a colour is generated from: a pasted reference wins over the supplier swatch. */
export const variantReference = (value: ReviewVariantValue) =>
  value.customReference
    ? { file: value.customReference, url: "" }
    : value.imageUrl
      ? { file: null, url: value.imageUrl }
      : null;

/** The hosted hero the extra colours are matched to. */
export const mainHeroImage = (reviewState: ProductReviewState) =>
  reviewState.images.find(
    (image) =>
      image.kind === "ai-generated" &&
      !image.variantHero &&
      image.imageKind === "hero" &&
      Boolean(image.hostedUrl),
  ) ?? null;

/** A colour's hero: the main set's hero for the main colour, the single hero otherwise. */
export const variantHeroImage = (reviewState: ProductReviewState, valueId: string) =>
  reviewState.images.find(
    (image) =>
      image.kind === "ai-generated" &&
      image.variantValueId === valueId &&
      (image.variantHero || image.imageKind === "hero"),
  ) ?? null;

const SET_ORDER: AiImageKind[] = ["hero", "heroAngled", "macro", "lifestyle"];

/**
 * The order generated images are shown and exported in: the main colour's set
 * in shot order, then one hero per extra colour in the supplier's colour order.
 * The first image becomes the product's main image in Shopify.
 */
export const sortGeneratedImages = (reviewState: ProductReviewState, images: ReviewImageField[]) => {
  const colourOrder = visualOption(reviewState)?.values.map((value) => value.id) ?? [];
  const rank = (image: ReviewImageField) =>
    image.variantHero
      ? SET_ORDER.length + colourOrder.indexOf(image.variantValueId ?? "")
      : SET_ORDER.indexOf(image.imageKind as AiImageKind);

  return [...images].sort((left, right) => rank(left) - rank(right));
};

/** Options that will reach the CSV, the visual one first so colour is Option1. */
const exportedOptions = (reviewState: ProductReviewState) =>
  [...reviewState.variants]
    .sort((left, right) => Number(right.visual) - Number(left.visual))
    .filter((option) => option.values.some((value) => value.approved));

const normalizedName = (value: string) => value.trim().toLowerCase();

/**
 * Reasons a product with variants cannot be exported yet. Each one would make
 * the Shopify import fail or silently produce something you did not approve.
 */
export const variantExportIssues = (reviewState: ProductReviewState) => {
  const issues: string[] = [];
  const options = exportedOptions(reviewState);

  for (const option of options) {
    if (!option.approved || !option.name.trim()) {
      issues.push(`Godkänn gruppnamnet för ${option.name.trim() || option.supplierName}.`);
    }

    const names = option.values.filter((value) => value.approved).map((value) => normalizedName(value.name));
    const duplicates = Array.from(new Set(names.filter((name, index) => names.indexOf(name) !== index)));
    if (duplicates.length > 0) {
      issues.push(`${option.name.trim() || option.supplierName} har samma namn flera gånger: ${duplicates.join(", ")}.`);
    }
  }

  if (options.length > MAX_SHOPIFY_OPTIONS) {
    issues.push(`Shopify tillåter högst ${MAX_SHOPIFY_OPTIONS} variantgrupper. Avmarkera alla val i en grupp.`);
  }

  if (options.length > 0 && issues.length === 0) {
    const count = buildDraftVariants(reviewState).variants.length;
    if (count === 0) {
      issues.push("Leverantören säljer ingen av de valda kombinationerna.");
    } else if (count > MAX_SHOPIFY_VARIANTS) {
      issues.push(`${count} varianter är fler än Shopifys gräns på ${MAX_SHOPIFY_VARIANTS}.`);
    }
  }

  return issues;
};

/**
 * One variant per approved combination the supplier actually sells. When the
 * page did not list combinations, every combination is assumed to exist.
 */
export const buildDraftVariants = (reviewState: ProductReviewState): { options: string[]; variants: DraftVariant[] } => {
  const options = exportedOptions(reviewState);
  if (options.length === 0) {
    return { options: [], variants: [] };
  }

  const approvedValues = options.map((option) => option.values.filter((value) => value.approved));
  const supplierCombinations = reviewState.rawData.variantCombinations;

  let combinations: string[][];
  if (supplierCombinations.length > 0) {
    const seen = new Set<string>();
    combinations = [];
    for (const combination of supplierCombinations) {
      const valueIds = options.map((option) => combination[option.id] ?? "");
      const allApproved = valueIds.every((valueId, index) =>
        approvedValues[index].some((value) => value.id === valueId),
      );
      const signature = valueIds.join("|");
      if (allApproved && !seen.has(signature)) {
        seen.add(signature);
        combinations.push(valueIds);
      }
    }
  } else {
    combinations = approvedValues.reduce<string[][]>(
      (accumulated, values) => accumulated.flatMap((prefix) => values.map((value) => [...prefix, value.id])),
      [[]],
    );
  }

  // Order like the supplier lists them, so the storefront picker reads naturally.
  const position = (optionIndex: number, valueId: string) =>
    options[optionIndex].values.findIndex((value) => value.id === valueId);
  combinations.sort((left, right) => {
    for (let index = 0; index < left.length; index += 1) {
      const difference = position(index, left[index]) - position(index, right[index]);
      if (difference !== 0) {
        return difference;
      }
    }
    return 0;
  });

  const visualIndex = options.findIndex((option) => option.visual);

  return {
    options: options.map((option) => option.name.trim()),
    variants: combinations.map((valueIds) => {
      const hero = visualIndex === -1 ? null : variantHeroImage(reviewState, valueIds[visualIndex]);
      return {
        imageUrl: hero?.approved ? hero.url : "",
        optionValues: valueIds.map(
          (valueId, index) => options[index].values.find((value) => value.id === valueId)?.name.trim() ?? "",
        ),
      };
    }),
  };
};

export const reviewField = (reviewState: ProductReviewState, key: ReviewTextFieldKey) =>
  reviewState.fields.find((field) => field.key === key);

export const requiredFieldsApproved = (reviewState: ProductReviewState) =>
  reviewState.fields.every((field) => field.approved && field.value.trim());

export const isReadyForExport = (reviewState: ProductReviewState) =>
  requiredFieldsApproved(reviewState) && variantExportIssues(reviewState).length === 0;

export const approvedSpecifications =(reviewState: ProductReviewState) =>
  reviewState.specifications
    .filter(
      (specification) =>
        specification.approved &&
        specification.name.trim() &&
        specification.value.trim() &&
        !isBlockedSpecification(specification),
    )
    .map((specification) => ({ name: specification.name.trim(), value: specification.value.trim() }));

export const approvedImageUrls = (reviewState: ProductReviewState) =>
  reviewState.images.filter((image) => image.kind === "ai-generated" && image.approved).map((image) => image.url);

export const buildApprovedDraft = (reviewState: ProductReviewState): ProductDraft => {
  const title = reviewField(reviewState, "title")?.value.trim() ?? "";
  const description = reviewField(reviewState, "description")?.value.trim() ?? "";
  const { options, variants } = buildDraftVariants(reviewState);

  return {
    description,
    handle: slugify(title),
    imageUrls: approvedImageUrls(reviewState),
    options,
    variants,
    seoDescription: buildSeoDescription(title, description),
    seoTitle: buildSeoTitle(title),
    sourceUrl: reviewState.rawData.sourceUrl,
    specifications: approvedSpecifications(reviewState),
    title,
  };
};
