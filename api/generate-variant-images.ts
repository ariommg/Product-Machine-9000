import { postJsonHandler } from "../server/lib/http.js";
import { generateVariantImages } from "../server/generateProductImages.js";
import type { AiProductGenerationResult } from "../src/types/ai.js";
import type { ExtractedProductData } from "../src/types/product.js";

export default postJsonHandler(
  async (body) => {
    if (!body.product) {
      throw new Error("Produktdata saknas i anropet.");
    }

    return generateVariantImages({
      aiText: (body.aiText as AiProductGenerationResult | null) ?? null,
      baseImageUrl: body.baseImageUrl,
      imageModel: body.imageModel,
      product: body.product as ExtractedProductData,
      targets: body.targets,
    });
  },
  (message) => {
    if (message.includes("OPENAI_API_KEY")) {
      return 500;
    }
    if (message.includes("Ogiltig") || message.includes("saknas i anropet") || message.includes("För många")) {
      return 400;
    }
    if (message.includes("Huvudbilden")) {
      return 422;
    }
    return 502;
  },
);
