import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_BODY_BYTES = 64 * 1024 * 1024;

export const readJsonBody = (request: IncomingMessage) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf8");
        const parsed: unknown = body ? JSON.parse(body) : {};
        resolve(typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {});
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Could not parse request body."));
      }
    });

    request.on("error", reject);
  });

export const sendJson = (response: ServerResponse, statusCode: number, payload: unknown) => {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
};

/** Wraps a POST-only JSON handler with shared parsing, method, and error handling. */
export const postJsonHandler =
  <T>(run: (body: Record<string, unknown>) => Promise<T>, statusForError: (message: string) => number) =>
  async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }

    try {
      sendJson(response, 200, await run(await readJsonBody(request)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Något gick fel.";
      sendJson(response, statusForError(message), { error: message });
    }
  };
