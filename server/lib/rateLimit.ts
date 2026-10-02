import OpenAI from "openai";

/** Image limits are per minute, so a full window is the safe guess when OpenAI gives no hint. */
const FALLBACK_WAIT_SECONDS = 60;
const MAX_WAIT_SECONDS = 120;
/** Waiting exactly the hinted time tends to land a hair early and get limited again. */
const WAIT_MARGIN_SECONDS = 2;

const UNIT_SECONDS: Record<string, number> = { h: 3600, m: 60, s: 1, ms: 0.001 };

/** Reads "Please try again in 12s", "in 1m30s" or "in 450ms" out of OpenAI's message. */
const secondsFromMessage = (message: string) => {
  const match = /try again in\s+((?:\d+(?:\.\d+)?\s*(?:ms|h|m|s)\s*)+)/i.exec(message);
  if (!match) {
    return null;
  }

  let total = 0;
  for (const part of match[1].matchAll(/(\d+(?:\.\d+)?)\s*(ms|h|m|s)/gi)) {
    total += Number(part[1]) * UNIT_SECONDS[part[2].toLowerCase()];
  }
  return total > 0 ? total : null;
};

const secondsFromHeaders = (headers: Headers | undefined) => {
  const milliseconds = Number(headers?.get("retry-after-ms"));
  if (Number.isFinite(milliseconds) && milliseconds > 0) {
    return milliseconds / 1000;
  }
  const seconds = Number(headers?.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
};

/**
 * How long to wait before retrying, or null when the error is not a rate limit
 * worth waiting out. Running out of credit is also a 429, but waiting does not
 * fix it, so it is reported as an ordinary failure.
 */
export const rateLimitWaitSeconds = (error: unknown): number | null => {
  if (!(error instanceof OpenAI.APIError) || error.status !== 429 || error.code === "insufficient_quota") {
    return null;
  }

  const hinted = secondsFromHeaders(error.headers) ?? secondsFromMessage(error.message) ?? FALLBACK_WAIT_SECONDS;
  return Math.min(Math.ceil(hinted + WAIT_MARGIN_SECONDS), MAX_WAIT_SECONDS);
};
