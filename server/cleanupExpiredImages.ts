import { del, list } from "@vercel/blob";

export const HOSTED_IMAGE_PREFIX = "product-machine-9000/ai-images/";

const DEFAULT_TTL_DAYS = 7;
const MIN_TTL_DAYS = 1;
const MAX_TTL_DAYS = 90;

export const getHostedImageTtlDays = () => {
  const configured = Number(process.env.HOSTED_IMAGE_TTL_DAYS);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_TTL_DAYS;
  }
  return Math.min(Math.max(Math.round(configured), MIN_TTL_DAYS), MAX_TTL_DAYS);
};

/**
 * Deletes generated images older than the TTL and nothing else. It is safe to
 * call from anywhere — an unexpired image is never touched — so it can run both
 * on a schedule and opportunistically when the app is opened.
 */
export const cleanupExpiredImages = async () => {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN saknas.");
  }

  const ttlDays = getHostedImageTtlDays();
  const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000;

  const expiredUrls: string[] = [];
  let keptCount = 0;
  let cursor: string | undefined;

  do {
    const result = await list({ cursor, limit: 1000, prefix: HOSTED_IMAGE_PREFIX });

    for (const blob of result.blobs) {
      if (blob.uploadedAt.getTime() < cutoff) {
        expiredUrls.push(blob.url);
      } else {
        keptCount += 1;
      }
    }

    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);

  // del() is free and accepts batches, but very large batches are chunked to
  // stay well inside the per-minute operation rate limit.
  for (let index = 0; index < expiredUrls.length; index += 100) {
    await del(expiredUrls.slice(index, index + 100));
  }

  return { deletedCount: expiredUrls.length, keptCount, ttlDays };
};
