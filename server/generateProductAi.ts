import OpenAI from "openai";
import {
  buildProductGenerationPrompt,
  forbiddenCustomerTerms,
  swatchCaption,
} from "./prompts/productGenerationPrompt.js";
import { fetchReferenceImage } from "./lib/referenceImages.js";
import { shrinkReferenceImage } from "./lib/shrinkReferenceImage.js";
import type { AiOptionName, AiProductGenerationResult, AiSpecConfidence } from "../src/types/ai.js";
import type { ExtractedProductData } from "../src/types/product.js";

const MODEL_FALLBACK = "gpt-5.4";

/** Naming only needs to tell colours and prints apart, so swatches are sent tiny. */
const SWATCH_MAX_EDGE = 256;
const MAX_SWATCHES = 40;

type SwatchInput = { caption: string; dataUrl: string };

/**
 * Downloads the swatch thumbnails so the model can name colours the supplier
 * only numbered. Fetched here rather than handed to OpenAI as URLs because
 * marketplace CDNs refuse anything that does not look like a browser.
 * Sequential, like every other reference fetch. A swatch that fails is skipped:
 * the value is still named, just from its text.
 */
const loadSwatches = async (product: ExtractedProductData) => {
  const targets = product.variantOptions
    .flatMap((option) =>
      option.values
        .filter((value) => value.thumbnailUrl)
        .map((value) => ({ caption: swatchCaption(option.name, value.id, value.name), url: value.thumbnailUrl })),
    )
    .slice(0, MAX_SWATCHES);

  const swatches: SwatchInput[] = [];
  for (const [index, target] of targets.entries()) {
    const attempt = await fetchReferenceImage(target.url, index);
    if (!("image" in attempt)) {
      continue;
    }
    const { image } = await shrinkReferenceImage(attempt.image, SWATCH_MAX_EDGE);
    swatches.push({
      caption: target.caption,
      dataUrl: `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString("base64")}`,
    });
  }

  return swatches;
};

const aiProductSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "specs", "options", "needsReview"],
  properties: {
    options: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "values"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          values: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "name"],
              properties: {
                id: { type: "string" },
                name: { type: "string" },
              },
            },
          },
        },
      },
    },
    title: { type: "string" },
    description: { type: "string" },
    specs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "value", "confidence"],
        properties: {
          name: { type: "string" },
          value: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
    needsReview: { type: "array", items: { type: "string" } },
  },
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const asString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const isConfidence = (value: unknown): value is AiSpecConfidence =>
  value === "high" || value === "medium" || value === "low";

const findForbiddenTerm = (value: string) =>
  forbiddenCustomerTerms.find((pattern) => pattern.test(value))?.exec(value)?.[0] ?? "";

/**
 * Sourcing wording is flagged rather than deleted. Wiping the whole field over one
 * stray word loses good copy, and nothing exports without a human ticking Approve
 * anyway, so surfacing the problem is safer than silently emptying the field.
 */
const checkCustomerText = (value: string, fieldLabel: string, warnings: string[]) => {
  const text = value.trim();
  const term = text ? findForbiddenTerm(text) : "";

  if (term) {
    warnings.push(`${fieldLabel} innehåller ordet "${term}" som inte hör hemma i kundtext. Redigera innan du godkänner.`);
  }

  return text;
};

/**
 * Only ids that exist in the parsed product are kept, so the model can neither
 * invent a variant nor drop one: a value it skipped simply keeps its supplier name.
 */
const validateOptions = (value: unknown, product: ExtractedProductData, warnings: string[]): AiOptionName[] => {
  const returned = Array.isArray(value) ? value.filter(isRecord) : [];

  return product.variantOptions.map((option) => {
    const match = returned.find((item) => asString(item.id) === option.id);
    const returnedValues = match && Array.isArray(match.values) ? match.values.filter(isRecord) : [];

    return {
      id: option.id,
      name: checkCustomerText(asString(match?.name) || option.name, "Ett variantgruppnamn", warnings),
      values: option.values.map((optionValue) => {
        const valueMatch = returnedValues.find((item) => asString(item.id) === optionValue.id);
        return {
          id: optionValue.id,
          name: checkCustomerText(asString(valueMatch?.name) || optionValue.name, "Ett variantnamn", warnings),
        };
      }),
    };
  });
};

const validateAiResult = (value: unknown, product: ExtractedProductData): AiProductGenerationResult => {
  if (!isRecord(value)) {
    throw new Error("AI-svaret hade fel format.");
  }

  const warnings: string[] = [];

  const needsReview = Array.isArray(value.needsReview)
    ? value.needsReview.map(asString).filter(Boolean)
    : [];

  const specs = Array.isArray(value.specs)
    ? value.specs
        .filter(isRecord)
        .map((spec) => ({
          confidence: isConfidence(spec.confidence) ? spec.confidence : "low",
          name: checkCustomerText(asString(spec.name), "En specifikation", warnings),
          value: checkCustomerText(asString(spec.value), "Ett specifikationsvärde", warnings),
        }))
        .filter((spec) => spec.name && spec.value)
    : [];

  return {
    description: checkCustomerText(asString(value.description), "Beskrivningen", warnings),
    needsReview,
    options: validateOptions(value.options, product, warnings),
    specs,
    title: checkCustomerText(asString(value.title), "Titeln", warnings),
    warnings,
  };
};

export const generateProductAi = async (product: ExtractedProductData): Promise<AiProductGenerationResult> => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY saknas.");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const swatches = await loadSwatches(product);

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || MODEL_FALLBACK,
    input: [
      {
        role: "system",
        content:
          "Du genererar strikt strukturerad JSON för Product Machine 9000. Returnera endast data som matchar schemat.",
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: buildProductGenerationPrompt(product) },
          ...swatches.flatMap((swatch) => [
            { type: "input_text" as const, text: swatch.caption },
            { type: "input_image" as const, detail: "low" as const, image_url: swatch.dataUrl },
          ]),
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "product_generation",
        strict: true,
        schema: aiProductSchema,
      },
    },
  });

  return validateAiResult(JSON.parse(response.output_text) as unknown, product);
};
