import { postJsonHandler } from "../server/lib/http.js";
import { generateProductImages } from "../server/generateProductImages.js";
import type { AiProductGenerationResult } from "../src/types/ai.js";
import type { ExtractedProductData } from "../src/types/product.js";

export default postJsonHandler(
  async (body) => {
    if (!body.product) {
      throw new Error("Produktdata saknas i anropet.");
    }

    return generateProductImages({
      aiText: (body.aiText as AiProductGenerationResult | null) ?? null,
      imageModel: body.imageModel,
      kinds: body.kinds,
      product: body.product as ExtractedProductData,
      referenceImageFiles: body.referenceImageFiles ?? [],
      referenceImageUrls: body.referenceImageUrls ?? [],
    });
  },
  (message) => {
    if (message.includes("OPENAI_API_KEY")) {
      return 500;
    }
    if (message.includes("Ogiltig") || message.includes("saknas i anropet")) {
      return 400;
    }
    if (message.includes("referensbild") || message.includes("För många")) {
      return 422;
    }
    return 502;
  },
);
