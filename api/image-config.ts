import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../server/lib/http.js";
import { getDefaultImageModel } from "../server/generateProductImages.js";

/** Non-secret defaults so the UI can start on the same model the server would pick. */
export default async function handler(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  sendJson(response, 200, {
    hostingConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    imageModel: getDefaultImageModel(),
  });
}
