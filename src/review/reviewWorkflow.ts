import { buildSeoDescription, buildSeoTitle, cleanProductTitle, slugify } from "../lib/productFormatting";
import type { ExtractedProductData, ProductDraft, ProductSpecification } from "../types/product";

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
  /** Source images are reference-only. Only generated images can reach Shopify. */
  kind: "source" | "ai-generated";
  label: string;
  url: string;
};

export type ProductReviewState = {
  fields: ReviewTextField[];
  images: ReviewImageField[];
  rawData: ExtractedProductData;
  specifications: ReviewSpecificationField[];
};

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
    kind: "source",
    label: `Källbild ${index + 1}`,
    url,
  })),
  rawData,
  specifications: buildSpecificationFields(rawData.specifications),
});

export const reviewField = (reviewState: ProductReviewState, key: ReviewTextFieldKey) =>
  reviewState.fields.find((field) => field.key === key);

export const requiredFieldsApproved = (reviewState: ProductReviewState) =>
  reviewState.fields.every((field) => field.approved && field.value.trim());

export const approvedSpecifications = (reviewState: ProductReviewState) =>
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

  return {
    description,
    handle: slugify(title),
    imageUrls: approvedImageUrls(reviewState),
    seoDescription: buildSeoDescription(title, description),
    seoTitle: buildSeoTitle(title),
    sourceUrl: reviewState.rawData.sourceUrl,
    specifications: approvedSpecifications(reviewState),
    title,
  };
};
