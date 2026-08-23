import { postJsonHandler } from "../server/lib/http.js";
import { generateProductAi } from "../server/generateProductAi.js";
import type { ExtractedProductData } from "../src/types/product.js";

export default postJsonHandler(
  async (body) => {
    if (!body.product) {
      throw new Error("Produktdata saknas i anropet.");
    }
    return generateProductAi(body.product as ExtractedProductData);
  },
  (message) => (message.includes("OPENAI_API_KEY") ? 500 : message.includes("saknas i anropet") ? 400 : 502),
);
