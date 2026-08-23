import { buildDescriptionHtml } from "./productFormatting";
import type { ProductDraft } from "../types/product";

/**
 * The exact column set from the Shopify export that imports cleanly today.
 * Metafield columns are deliberately absent. Do not reorder or extend without
 * re-testing a real Shopify import first.
 */
export const SHOPIFY_CSV_HEADERS = [
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

type ShopifyCsvHeader = (typeof SHOPIFY_CSV_HEADERS)[number];
type ShopifyCsvRow = Partial<Record<ShopifyCsvHeader, string>>;

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

const buildMainProductRow = (draft: ProductDraft): ShopifyCsvRow => {
  const firstImage = publicShopifyImageUrls(draft.imageUrls)[0] ?? "";

  return {
    Title: draft.title,
    "URL handle": draft.handle,
    Description: buildDescriptionHtml(draft.description, draft.specifications),
    Vendor: "",
    "Product category": "",
    Type: "",
    Tags: "",
    "Published on online store": "TRUE",
    Status: "draft",
    SKU: "",
    Barcode: "",
    "Option1 name": "Title",
    "Option1 value": "Default Title",
    Price: "0",
    "Charge tax": "FALSE",
    "Inventory tracker": "",
    "Inventory quantity": "",
    "Continue selling when out of stock": "deny",
    "Weight unit for display": "g",
    "Requires shipping": "TRUE",
    "Fulfillment service": "manual",
    "Product image URL": firstImage,
    "Image position": firstImage ? "1" : "",
    "Image alt text": firstImage ? draft.title : "",
    "Gift card": "FALSE",
    "SEO title": draft.seoTitle,
    "SEO description": draft.seoDescription,
    "Google Shopping / Manufacturer part number (MPN)": "",
    "Google Shopping / Condition": "New",
    "Google Shopping / Custom product": "FALSE",
  };
};

/** Extra images ride on handle-only rows, which is how Shopify attaches a gallery. */
const buildImageOnlyRow = (draft: ProductDraft, imageUrl: string, imagePosition: number): ShopifyCsvRow => ({
  "URL handle": draft.handle,
  "Product image URL": imageUrl,
  "Image position": String(imagePosition),
  "Image alt text": draft.title,
});

export const buildShopifyCsvRows = (draft: ProductDraft): ShopifyCsvRow[] => {
  const additionalImageRows = publicShopifyImageUrls(draft.imageUrls)
    .slice(1)
    .map((imageUrl, index) => buildImageOnlyRow(draft, imageUrl, index + 2));

  return [buildMainProductRow(draft), ...additionalImageRows];
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
