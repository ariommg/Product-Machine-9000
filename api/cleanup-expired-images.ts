import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../server/lib/http.js";
import { cleanupExpiredImages } from "../server/cleanupExpiredImages.js";

/**
 * Safe to call unauthenticated: it only ever deletes images that are already
 * past the TTL. Set CRON_SECRET to require Vercel's cron Authorization header
 * anyway, which stops anyone else burning list operations.
 */
export default async function handler(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== "POST" && request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.authorization !== `Bearer ${cronSecret}`) {
    sendJson(response, 401, { error: "Unauthorized." });
    return;
  }

  try {
    sendJson(response, 200, await cleanupExpiredImages());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rensningen misslyckades.";
    sendJson(response, message.includes("BLOB_READ_WRITE_TOKEN") ? 500 : 502, { error: message });
  }
}
