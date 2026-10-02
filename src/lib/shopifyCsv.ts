import { buildDescriptionHtml, buildSpecificationsText } from "./productFormatting";
import type { DraftVariant, ProductDraft } from "../types/product";

/**
 * The specifications metafield.
 *
 * Shopify's CSV importer only accepts plain metafield types — rich_text_field is
 * NOT among them — so the definition in Shopify must be "Multi-line text".
 * Namespace and key are found under Settings > Custom data > Products.
 * Override per deployment with VITE_SPECS_METAFIELD, formatted "namespace.key".
 */
const SPECS_METAFIELD_LABEL = "Specifikationer";
const SPECS_METAFIELD_PATH = import.meta.env?.VITE_SPECS_METAFIELD || "custom.specifikationer";

export const SPECS_METAFIELD_HEADER = `${SPECS_METAFIELD_LABEL} (product.metafields.${SPECS_METAFIELD_PATH})`;

/**
 * The exact column set from the Shopify export that imports cleanly today,
 * plus the specifications metafield column. Do not reorder or extend without
 * re-testing a real Shopify import first.
 */
const BASE_CSV_HEADERS = [
  "Title",
  "URL handle",
  "Description",
  "Vendor",
  "Product category",
  "Type",
  "Tags",
  "Published on online store",
  "Status",
  "SKU",
  "Barcode",
  "Option1 name",
  "Option1 value",
  "Option1 Linked To",
  "Option2 name",
  "Option2 value",
  "Option2 Linked To",
  "Option3 name",
  "Option3 value",
  "Option3 Linked To",
  "Price",
  "Compare-at price",
  "Cost per item",
  "Charge tax",
  "Tax code",
  "Unit price total measure",
  "Unit price total measure unit",
  "Unit price base measure",
  "Unit price base measure unit",
  "Inventory tracker",
  "Inventory quantity",
  "Continue selling when out of stock",
  "Weight value (grams)",
  "Weight unit for display",
  "Requires shipping",
  "Fulfillment service",
  "Product image URL",
  "Image position",
  "Image alt text",
  "Variant image URL",
  "Gift card",
  "SEO title",
  "SEO description",
  "Google Shopping / Google product category",
  "Google Shopping / Gender",
  "Google Shopping / Age group",
  "Google Shopping / Manufacturer part number (MPN)",
  "Google Shopping / Ad group name",
  "Google Shopping / Ads labels",
  "Google Shopping / Condition",
  "Google Shopping / Custom product",
  "Google Shopping / Custom label 0",
  "Google Shopping / Custom label 1",
  "Google Shopping / Custom label 2",
  "Google Shopping / Custom label 3",
  "Google Shopping / Custom label 4",
] as const;

export const SHOPIFY_CSV_HEADERS: string[] = [...BASE_CSV_HEADERS, SPECS_METAFIELD_HEADER];

type ShopifyCsvRow = Record<string, string>;

const escapeCsvValue = (value = "") => `"${value.replace(/"/g, '""')}"`;

/** Shopify only imports images it can download itself, so the URL must be public https. */
export const isPublicShopifyImageUrl = (imageUrl: string) => {
  try {
    const url = new URL(imageUrl.trim());
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      hostname !== "localhost" &&
      hostname !== "127.0.0.1" &&
      hostname !== "::1" &&
      !hostname.endsWith(".local")
    );
  } catch {
    return false;
  }
};

export const publicShopifyImageUrls = (imageUrls: string[]) =>
  imageUrls.map((imageUrl) => imageUrl.trim()).filter((imageUrl) => imageUrl && isPublicShopifyImageUrl(imageUrl));

const OPTION_NUMBERS = [1, 2, 3] as const;

const publicOrBlank = (imageUrl: string) => (isPublicShopifyImageUrl(imageUrl) ? imageUrl.trim() : "");

/**
 * Columns every variant row repeats. Price is always 0 and the supplier price
 * never reaches the CSV, for variants exactly as for single products.
 */
const variantColumns = (variant: DraftVariant | null): ShopifyCsvRow => ({
  ...Object.fromEntries(
    OPTION_NUMBERS.map((number, index) => [
      `Option${number} value`,
      variant ? (variant.optionValues[index] ?? "") : number === 1 ? "Default Title" : "",
    ]),
  ),
  Price: "0",
  "Charge tax": "FALSE",
  "Inventory tracker": "",
  "Inventory quantity": "",
  "Continue selling when out of stock": "deny",
  "Weight unit for display": "g",
  "Requires shipping": "TRUE",
  "Fulfillment service": "manual",
  "Variant image URL": variant ? publicOrBlank(variant.imageUrl) : "",
});

/** Option names go on the first row only; Shopify reads them from there. */
const optionNameColumns = (draft: ProductDraft): ShopifyCsvRow =>
  Object.fromEntries(
    OPTION_NUMBERS.map((number, index) => [
      `Option${number} name`,
      draft.variants.length > 0 ? (draft.options[index] ?? "") : number === 1 ? "Title" : "",
    ]),
  );

const buildMainProductRow = (draft: ProductDraft): ShopifyCsvRow => {
  const firstImage = publicShopifyImageUrls(draft.imageUrls)[0] ?? "";

  return {
    ...optionNameColumns(draft),
    ...variantColumns(draft.variants[0] ?? null),
    Title: draft.title,
    "URL handle": draft.handle,
    Description: buildDescriptionHtml(draft.description),
    Vendor: "",
    "Product category": "",
    Type: "",
    Tags: "",
    "Published on online store": "TRUE",
    Status: "draft",
    SKU: "",
    Barcode: "",
    "Product image URL": firstImage,
    "Image position": firstImage ? "1" : "",
    "Image alt text": firstImage ? draft.title : "",
    "Gift card": "FALSE",
    "SEO title": draft.seoTitle,
    "SEO description": draft.seoDescription,
    "Google Shopping / Manufacturer part number (MPN)": "",
    "Google Shopping / Condition": "New",
    "Google Shopping / Custom product": "FALSE",
    // Specs live here rather than in the description.
    [SPECS_METAFIELD_HEADER]: buildSpecificationsText(draft.specifications),
  };
};

/** Extra images ride on handle-only rows, which is how Shopify attaches a gallery. */
const buildImageOnlyRow = (draft: ProductDraft, imageUrl: string, imagePosition: number): ShopifyCsvRow => ({
  "URL handle": draft.handle,
  "Product image URL": imageUrl,
  "Image position": String(imagePosition),
  "Image alt text": draft.title,
});

/**
 * Every variant after the first rides on a handle-only row. Like image rows,
 * these leave the product-level columns and the metafield empty.
 */
const buildVariantRow = (draft: ProductDraft, variant: DraftVariant): ShopifyCsvRow => ({
  "URL handle": draft.handle,
  ...variantColumns(variant),
});

export const buildShopifyCsvRows = (draft: ProductDraft): ShopifyCsvRow[] => {
  const additionalVariantRows = draft.variants.slice(1).map((variant) => buildVariantRow(draft, variant));
  const additionalImageRows = publicShopifyImageUrls(draft.imageUrls)
    .slice(1)
    .map((imageUrl, index) => buildImageOnlyRow(draft, imageUrl, index + 2));

  return [buildMainProductRow(draft), ...additionalVariantRows, ...additionalImageRows];
};

export const buildShopifyCsv = (drafts: ProductDraft[]) => {
  const rows = drafts.flatMap(buildShopifyCsvRows);

  return [
    SHOPIFY_CSV_HEADERS.join(","),
    ...rows.map((row) => SHOPIFY_CSV_HEADERS.map((header) => escapeCsvValue(row[header] ?? "")).join(",")),
  ].join("\n");
};

export const buildCsvFilename = (productCount: number) => {
  const stamp = new Date().toISOString().slice(0, 10);
  return `product-machine-9000-${stamp}-${productCount}-produkter.csv`;
};

export const downloadCsvFile = (contents: string, filename: string) => {
  // The BOM keeps Swedish characters intact when the file is opened in Excel.
  const blob = new Blob(["\ufeff", contents], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};
