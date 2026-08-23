import type { AiImageKind, AiProductGenerationResult } from "../../src/types/ai.js";
import type { ExtractedProductData } from "../../src/types/product.js";

/** Only what helps the model see the product. No supplier or logistics data. */
const imageProductContext = (product: ExtractedProductData, aiText: AiProductGenerationResult | null) => ({
  description: aiText?.description || product.description,
  specifications: (aiText?.specs?.length ? aiText.specs : product.specifications).map((specification) => ({
    name: specification.name,
    value: specification.value,
  })),
  title: aiText?.title || product.title,
});

const FIDELITY_RULES = `Treat every reference image as the visual source of truth.
Preserve the real product's shape, silhouette, proportions, materials, colours, texture, finish, visible patterns, parts, edges, openings, handles, attachments and every distinctive detail.
When several references are supplied, read them together as different angles or details of one single product.
Do not redesign the product into a generic version of its category. Do not add, remove, or simplify features. Do not invent branding.
Read scale clues in the references: measurement arrows, dimension labels, cm/mm/inch text, size diagrams, hands, food, furniture, or nearby objects. Use them only to keep proportions believable, and never reproduce measurement text in the generated image.`;

const OUTPUT_RULES = `No text, labels, logos, watermarks, brand marks, packaging copy, stickers, or graphic overlays anywhere in the image.
Photorealistic result, correct perspective, natural materials, no illustration or 3D-render look.
Keep the whole product inside the frame with comfortable margin, and keep the composition centred and level.`;

/** The set should read as one photo shoot, not four unrelated images. */
const SET_CONSISTENCY = `This image belongs to a set of product photos of the same item. Keep the lighting temperature, background tone, and material rendering consistent with a clean, neutral studio set.`;

const KIND_INSTRUCTIONS: Record<AiImageKind, string> = {
  hero: `HERO SHOT. The product alone, centred, straight-on or very slightly angled. Plain light neutral background, soft even studio lighting, soft natural contact shadow. This is the main catalogue image.`,
  heroAngled: `ANGLED SHOT. The same product from a three-quarter angle, framed slightly wider than the hero shot. Same plain light neutral background and same lighting as the hero shot.`,
  macro: `DETAIL SHOT. A close crop on the single most telling part of the product: material, texture, finish, an edge, a joint, a handle, a rim, or a surface pattern. Shallow depth of field, sharp focus on the detail, same neutral background family.`,
  lifestyle: `LIFESTYLE SHOT. The product in natural use, in the setting where this specific kind of product actually belongs. Infer that setting from the product itself and never default to a kitchen. Realistic daylight, uncluttered and tidy surroundings, calm modern styling. Hands may appear if they show how the product is used, but no faces and no recognisable people.`,
};

export const buildImageGenerationPrompt = (
  kind: AiImageKind,
  product: ExtractedProductData,
  aiText: AiProductGenerationResult | null,
) =>
  [
    "Create a realistic ecommerce product photograph for an online store.",
    KIND_INSTRUCTIONS[kind],
    SET_CONSISTENCY,
    FIDELITY_RULES,
    OUTPUT_RULES,
    `Product context: ${JSON.stringify(imageProductContext(product, aiText))}`,
  ].join("\n\n");
