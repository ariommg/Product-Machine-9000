import type { ProductSpecification } from "../types/product";

export const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

/**
 * Swedish letters must survive as their latin base rather than being dropped.
 * "Rivjärn" has to become "rivjarn", never "rivj-rn".
 */
export const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ø/gi, "o")
    .replace(/æ/gi, "ae")
    .replace(/ß/gi, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

/** Supplier listing titles are keyword soup. Strip the marketplace boilerplate. */
export const cleanProductTitle = (title: string) =>
  normalizeWhitespace(
    title
      .replace(/\bbuy\s+/gi, "")
      .replace(/\s*[-|,]?\s*product\s+on\s+alibaba\.com\b/gi, "")
      .replace(/\s*[-|,]?\s*alibaba\.com\b/gi, "")
      .replace(/\s+(supplier|manufacturer|factory|wholesale)\s*$/gi, ""),
  );

export const limitText = (value: string, maxLength: number) => {
  const compact = normalizeWhitespace(value);
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1).trimEnd()}…`;
};

export const buildSeoTitle = (title: string) => limitText(cleanProductTitle(title), 70);

export const buildSeoDescription = (title: string, description: string) =>
  limitText(`${cleanProductTitle(title)}. ${stripHtml(description)}`, 155);

export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const stripHtml = (value: string) => normalizeWhitespace(value.replace(/<[^>]*>/g, " "));

/**
 * Shopify renders the Description column as HTML, so plain newlines collapse into
 * one run-on paragraph. Emit real markup instead.
 */
export const buildDescriptionHtml = (description: string, specifications: ProductSpecification[]) => {
  const paragraphs = description
    .split(/\n{2,}|\r\n{2,}/)
    .map((paragraph) => normalizeWhitespace(paragraph))
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`);

  const usableSpecifications = specifications.filter(
    (specification) => specification.name.trim() && specification.value.trim(),
  );

  if (usableSpecifications.length === 0) {
    return paragraphs.join("");
  }

  const specificationItems = usableSpecifications.map(
    (specification) =>
      `<li><strong>${escapeHtml(specification.name.trim())}:</strong> ${escapeHtml(specification.value.trim())}</li>`,
  );

  // Joined without newlines so each product stays on one physical CSV line.
  return [...paragraphs, "<h4>Specifikationer</h4>", "<ul>", ...specificationItems, "</ul>"].join("");
};

export const formatSpecificationsForCopy = (specifications: ProductSpecification[]) =>
  specifications.map((item) => `- ${item.name}: ${item.value}`).join("\n");

export const formatUrlsForCopy = (urls: string[]) => urls.map((item) => `- ${item}`).join("\n");
