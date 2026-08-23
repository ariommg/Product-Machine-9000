import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import deleteHostedImagesHandler from "./api/delete-hosted-images.js";
import generateImagesHandler from "./api/generate-images.js";
import generateProductHandler from "./api/generate-product.js";
import imageConfigHandler from "./api/image-config.js";

const apiRoutes = {
  "/api/generate-product": generateProductHandler,
  "/api/generate-images": generateImagesHandler,
  "/api/image-config": imageConfigHandler,
  "/api/delete-hosted-images": deleteHostedImagesHandler,
};

const serverEnvKeys = [
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_IMAGE_MODEL",
  "OPENAI_IMAGE_QUALITY",
  "OPENAI_IMAGE_SIZE",
  "BLOB_READ_WRITE_TOKEN",
];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  for (const key of serverEnvKeys) {
    process.env[key] ||= env[key];
  }

  return {
    plugins: [
      react(),
      {
        name: "product-machine-api",
        configureServer(server) {
          for (const [route, handler] of Object.entries(apiRoutes)) {
            server.middlewares.use(route, (request, response) => {
              void handler(request, response);
            });
          }
        },
      },
    ],
  };
});
