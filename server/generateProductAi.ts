import OpenAI from "openai";
import { buildProductGenerationPrompt, forbiddenCustomerTerms } from "./prompts/productGenerationPrompt.js";
import type { AiProductGenerationResult, AiSpecConfidence } from "../src/types/ai.js";
import type { ExtractedProductData } from "../src/types/product.js";

const MODEL_FALLBACK = "gpt-5.4";

const aiProductSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "specs", "needsReview"],
  properties: {
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

const validateAiResult = (value: unknown): AiProductGenerationResult => {
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

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || MODEL_FALLBACK,
    input: [
      {
        role: "system",
        content:
          "Du genererar strikt strukturerad JSON för Product Machine 9000. Returnera endast data som matchar schemat.",
      },
      { role: "user", content: buildProductGenerationPrompt(product) },
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

  return validateAiResult(JSON.parse(response.output_text) as unknown);
};
