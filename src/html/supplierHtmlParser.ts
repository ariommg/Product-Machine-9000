import { cleanProductTitle, normalizeWhitespace } from "../lib/productFormatting";
import type {
  ExtractedProductData,
  ProductSpecification,
  VariantCombination,
  VariantOption,
} from "../types/product";

type HtmlImportInput = {
  fileName: string;
  html: string;
};

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord => typeof value === "object" && value !== null;
const asArray = (value: unknown) => (Array.isArray(value) ? value : []);
const unique = <T,>(items: T[]) => Array.from(new Set(items));

const asString = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? normalizeWhitespace(String(value)) : "";

const getPath = (source: unknown, path: string[]) =>
  path.reduce<unknown>((current, segment) => (isRecord(current) ? current[segment] : undefined), source);

const metaContent = (document: Document, selector: string) =>
  normalizeWhitespace(document.querySelector<HTMLMetaElement>(selector)?.content ?? "");

/** Protocol-relative CDN URLs are common in saved marketplace pages. */
export const normalizeMediaUrl = (url: string) => {
  const trimmed = url.trim().replace(/\\\//g, "/");
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  return trimmed;
};

const cleanSpecificationText = (value: string) =>
  normalizeWhitespace(value.replace(/ /g, " ").replace(/\s*([×x*])\s*/gi, " $1 "));

/** Unit casing only. No product-category assumptions belong in the parser. */
const normalizeUnits = (value: string) =>
  cleanSpecificationText(value)
    .replace(/\b(MM|CM|KG|ML|CL)\b/g, (unit) => unit.toLowerCase())
    .replace(/\s*\/\s*/g, " / ")
    .trim();

const normalizeSpecificationName = (name: string) => cleanSpecificationText(name).replace(/[:：]+\s*$/g, "");

const dedupeSpecifications = (specifications: ProductSpecification[]) => {
  const seen = new Set<string>();
  return specifications.filter((specification) => {
    if (!specification.name || !specification.value) {
      return false;
    }
    const key = `${specification.name.toLowerCase()}:::${specification.value.toLowerCase()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const toSpecification = (name: string, value: string, source: string): ProductSpecification | null => {
  const normalizedName = normalizeSpecificationName(name);
  const normalizedValue = normalizeUnits(value);
  if (!normalizedName || !normalizedValue || normalizedName.length > 80) {
    return null;
  }
  return { name: normalizedName, source, value: normalizedValue };
};

const findMatchingBraceEnd = (source: string, startIndex: number) => {
  let depth = 0;
  let inString = false;
  let stringQuote = "";
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === stringQuote) {
        inString = false;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      inString = true;
      stringQuote = character;
      continue;
    }

    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
};

const parseJsonLikeObject = (value: string) => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    try {
      const unescaped = value.replace(/\\x([0-9a-f]{2})/gi, (_, hex: string) =>
        String.fromCharCode(parseInt(hex, 16)),
      );
      return JSON.parse(unescaped) as unknown;
    } catch {
      return null;
    }
  }
};

const extractDetailData = (html: string) => {
  const assignmentIndex = html.search(/window\.detailData\s*=/);
  if (assignmentIndex === -1) {
    return null;
  }
  const braceStart = html.indexOf("{", assignmentIndex);
  if (braceStart === -1) {
    return null;
  }
  const braceEnd = findMatchingBraceEnd(html, braceStart);
  if (braceEnd === -1) {
    return null;
  }
  return parseJsonLikeObject(html.slice(braceStart, braceEnd + 1));
};

const collectBasicProperties = (product: UnknownRecord) => {
  const rawProperties = product.productBasicProperties;
  const specifications: ProductSpecification[] = [];
  const source = "product.productBasicProperties";

  if (Array.isArray(rawProperties)) {
    for (const item of rawProperties) {
      if (!isRecord(item)) {
        continue;
      }
      const name = asString(item.name ?? item.attrName ?? item.propertyName ?? item.key ?? item.title);
      const value = asString(item.value ?? item.attrValue ?? item.propertyValue ?? item.text);
      const specification = toSpecification(name, value, source);
      if (specification) {
        specifications.push(specification);
      }
    }
  } else if (isRecord(rawProperties)) {
    for (const [name, value] of Object.entries(rawProperties)) {
      const specification = toSpecification(name, asString(value), source);
      if (specification) {
        specifications.push(specification);
      }
    }
  }

  return dedupeSpecifications(specifications);
};

const formatTiers = (list: unknown, valueKeys: string[]) =>
  asArray(list)
    .map((item) => {
      if (!isRecord(item)) {
        return "";
      }
      const quantity = asString(item.quantity ?? item.minQuantity ?? item.startQuantity ?? item.min ?? item.qty);
      const value = valueKeys.map((key) => asString(item[key])).find(Boolean) ?? "";
      return [quantity, value].filter(Boolean).join(": ");
    })
    .filter(Boolean)
    .join(" | ");

const collectDetailDataMedia = (product: UnknownRecord) => {
  const mediaItems = asArray(product.mediaItems).filter(isRecord);

  const imageUrls = mediaItems
    .filter((item) => item.type === "image")
    .map((item) =>
      normalizeMediaUrl(
        asString(getPath(item, ["imageUrl", "big"])) ||
          asString(getPath(item, ["imageUrl", "main"])) ||
          asString(getPath(item, ["imageUrl", "normal"])) ||
          asString(item.imageUrl),
      ),
    )
    .filter(Boolean);

  const videoUrls = mediaItems
    .filter((item) => item.type === "video")
    .flatMap((item) =>
      [
        asString(item.videoUrl),
        asString(item.url),
        asString(getPath(item, ["videoUrl", "hd"])),
        asString(getPath(item, ["videoUrl", "sd"])),
      ].map(normalizeMediaUrl),
    )
    .filter(Boolean);

  return { imageUrls: unique(imageUrls), videoUrls: unique(videoUrls) };
};

/**
 * Variant options live in product.sku.skuAttrs. Each value can carry its own
 * swatch picture, which matters more than its name: suppliers often name
 * colours "1", "2", "3", and a print is not describable as one colour anyway.
 */
const collectVariants = (product: UnknownRecord) => {
  const sku = isRecord(product.sku) ? product.sku : {};
  const rawAttrs = asArray(sku.skuAttrs).length > 0 ? asArray(sku.skuAttrs) : asArray(sku.skuSummaryAttrs);

  const allOptions: VariantOption[] = rawAttrs.filter(isRecord).flatMap((attr) => {
    const id = asString(attr.id);
    const name = asString(attr.name);
    if (!id || !name) {
      return [];
    }

    const values = asArray(attr.values)
      .filter(isRecord)
      .map((value) => ({
        hexColor: /^#[0-9a-f]{3,8}$/i.test(asString(value.color)) ? asString(value.color) : "",
        id: asString(value.id),
        imageUrl: normalizeMediaUrl(asString(value.originImage) || asString(value.largeImage)),
        name: asString(value.name),
        thumbnailUrl: normalizeMediaUrl(
          asString(value.largeImage) || asString(value.smallImage) || asString(value.originImage),
        ),
      }))
      .filter((value) => value.id && value.name);

    // The supplier's display type says which option is shown as pictures. The
    // option name is unreliable: sizes are routinely listed under "color" just
    // to get a picture per value.
    const displayType = asString(attr.type).toUpperCase();
    const visual = displayType === "IMAGE" || displayType === "COLOR";

    return [{ id, name, values, visual }];
  });

  const options = allOptions.filter((option) => option.values.length >= 2);
  const skippedOptions = allOptions.filter((option) => option.values.length < 2);

  // Only the first visual option drives images. A second one is kept as a plain option.
  const firstVisualId = options.find((option) => option.visual)?.id;
  for (const option of options) {
    option.visual = option.id === firstVisualId;
  }

  const keptIds = new Set(options.map((option) => option.id));
  const seen = new Set<string>();
  const combinations: VariantCombination[] = [];

  // Keys look like "191288010:-37;191286164:-6;". Single-value options are
  // projected away, which can make several keys collapse into one.
  for (const key of Object.keys(isRecord(sku.skuInfoMap) ? sku.skuInfoMap : {})) {
    const combination: VariantCombination = {};
    for (const pair of key.split(";")) {
      const [optionId, valueId] = pair.split(":");
      if (optionId && valueId && keptIds.has(optionId)) {
        combination[optionId] = valueId;
      }
    }

    if (Object.keys(combination).length !== keptIds.size) {
      continue;
    }

    const signature = options.map((option) => combination[option.id]).join("|");
    if (!seen.has(signature)) {
      seen.add(signature);
      combinations.push(combination);
    }
  }

  return { combinations, options, skippedOptions };
};

const tableLooksLikeProductDetail =(table: HTMLTableElement) => {
  const context = normalizeWhitespace(
    [
      table.caption?.textContent ?? "",
      table.closest("[data-module-name], section, div")?.textContent?.slice(0, 1200) ?? "",
      table.previousElementSibling?.textContent ?? "",
    ].join(" "),
  );

  return /produktdetaljer|produktbeskrivning|produktinformation|specifikation|product details|description|specifications|product overview|attributes/i.test(
    context,
  );
};

const collectTableSpecifications = (document: Document) => {
  const specifications: ProductSpecification[] = [];

  document.querySelectorAll("table").forEach((table) => {
    const htmlTable = table as HTMLTableElement;
    const tableSpecs: ProductSpecification[] = [];

    htmlTable.querySelectorAll("tr").forEach((row) => {
      const cells = Array.from(row.querySelectorAll("th, td"))
        .map((cell) => cleanSpecificationText(cell.textContent ?? ""))
        .filter(Boolean);

      if (cells.length === 2) {
        const specification = toSpecification(cells[0], cells[1], "produktdetaljtabell");
        if (specification) {
          tableSpecs.push(specification);
        }
      }
    });

    // A two-column table is only a spec table if it sits in a product-detail
    // context or is long enough that it cannot be an incidental layout table.
    if (tableSpecs.length > 0 && (tableLooksLikeProductDetail(htmlTable) || tableSpecs.length >= 3)) {
      specifications.push(...tableSpecs);
    }
  });

  return dedupeSpecifications(specifications);
};

const collectFallbackMediaUrls = (html: string, extensions: string[]) => {
  const escapedExtensions = extensions.map((extension) => extension.replace(".", "\\."));
  const pattern = new RegExp(
    `https?:\\\\?/\\\\?/[^"'\\s<>]+(?:${escapedExtensions.join("|")})(?:\\?[^"'\\s<>]*)?`,
    "gi",
  );

  return unique(html.match(pattern) ?? [])
    .map(normalizeMediaUrl)
    .filter((url) => /^https?:\/\//i.test(url))
    .filter((url) => !/(logo|header|sprite|icon|banner|avatar|placeholder)/i.test(url));
};

const parseFromDetailData = (
  detailData: unknown,
  fileName: string,
  domSpecifications: ProductSpecification[],
): ExtractedProductData | null => {
  if (!isRecord(detailData)) {
    return null;
  }

  const globalData = isRecord(detailData.globalData) ? detailData.globalData : detailData;
  const product = getPath(globalData, ["product"]);
  if (!isRecord(product)) {
    return null;
  }

  const seller = isRecord(getPath(globalData, ["seller"])) ? (getPath(globalData, ["seller"]) as UnknownRecord) : {};
  const trade = isRecord(getPath(globalData, ["trade"])) ? (getPath(globalData, ["trade"]) as UnknownRecord) : {};
  const logisticInfo = isRecord(trade.logisticInfo) ? trade.logisticInfo : {};
  const leadTimeInfo = isRecord(trade.leadTimeInfo) ? trade.leadTimeInfo : {};
  const price = isRecord(product.price) ? product.price : {};

  const specifications = dedupeSpecifications([...collectBasicProperties(product), ...domSpecifications]);
  const media = collectDetailDataMedia(product);
  const variants = collectVariants(product);
  const title =cleanProductTitle(asString(product.subject) || "Produktutkast");
  const priceTiers = formatTiers(price.productLadderPrices, ["price", "formatPrice", "formattedPrice", "value"]);

  return {
    description: asString(product.description) || asString(product.descriptionHtml),
    extractionNotes: [
      "Källa: window.detailData.globalData.",
      `Importerad fil: ${fileName}.`,
      media.imageUrls.length > 0
        ? `${media.imageUrls.length} produktbild(er) hittades i product.mediaItems.`
        : "Inga produktbilder hittades i product.mediaItems.",
      domSpecifications.length > 0
        ? `${domSpecifications.length} specifikation(er) hittades i produktdetaljtabeller.`
        : "Inga specifikationer hittades i produktdetaljtabeller.",
      variants.options.length > 0
        ? `Varianter i product.sku: ${variants.options
            .map((option) => `${option.name} (${option.values.length})`)
            .join(", ")}. ${variants.combinations.length} kombination(er) finns hos leverantören.`
        : "Inga varianter med flera val hittades i product.sku.",
      ...(variants.skippedOptions.length > 0
        ? [
            `Hoppade över grupper med ett enda val: ${variants.skippedOptions
              .map((option) => `${option.name} (${option.values[0]?.name ?? "tom"})`)
              .join(", ")}.`,
          ]
        : []),
    ],
    imageUrls: media.imageUrls,
    // Logistics data is kept apart from specs so it can never become product data.
    leadTime: formatTiers(leadTimeInfo.ladderPeriodList, ["period", "leadTime", "days", "value"]),
    minimumOrderQuantity: asString(product.moq),
    packageDimensions: asString(logisticInfo.unitSize),
    packageWeight: asString(logisticInfo.unitWeight),
    sourceUrl: normalizeMediaUrl(asString(product.detailUrl)) || fileName,
    specifications,
    supplierName: asString(seller.companyName),
    supplierPrice: asString(price.formatLadderPrice) || priceTiers,
    supplierSku:
      specifications.find((item) => /model number|modellnummer|item number|artikelnummer/i.test(item.name))?.value ?? "",
    title,
    variantCombinations: variants.combinations,
    variantOptions: variants.options,
    videoUrls: media.videoUrls,
  };
};

const parseFromDomFallback = (document: Document, html: string, fileName: string): ExtractedProductData => {
  const title = cleanProductTitle(
    metaContent(document, 'meta[property="og:title"]') ||
      normalizeWhitespace(document.querySelector("h1")?.textContent ?? "") ||
      "Produktutkast",
  );

  const description =
    metaContent(document, 'meta[name="description"]') || metaContent(document, 'meta[property="og:description"]');

  return {
    description,
    extractionNotes: [
      "Källa: DOM-fallback. window.detailData saknades eller gick inte att tolka.",
      `Importerad fil: ${fileName}.`,
      "Kontrollera alla fält extra noga innan du godkänner dem.",
    ],
    imageUrls: collectFallbackMediaUrls(html, [".jpg", ".jpeg", ".png", ".webp", ".avif"]).slice(0, 24),
    leadTime: "",
    minimumOrderQuantity: "",
    packageDimensions: "",
    packageWeight: "",
    sourceUrl:
      metaContent(document, 'meta[property="og:url"]') ||
      document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ||
      fileName,
    specifications: collectTableSpecifications(document),
    supplierName: "",
    supplierPrice: "",
    supplierSku: "",
    title,
    variantCombinations: [],
    variantOptions: [],
    videoUrls: collectFallbackMediaUrls(html, [".mp4", ".webm", ".m3u8"]).slice(0, 12),
  };
};

export const parseSupplierHtmlFile = ({ fileName, html }: HtmlImportInput): ExtractedProductData => {
  const document = new DOMParser().parseFromString(html, "text/html");
  const domSpecifications = collectTableSpecifications(document);
  const detailData = extractDetailData(html);

  return parseFromDetailData(detailData, fileName, domSpecifications) ?? parseFromDomFallback(document, html, fileName);
};
