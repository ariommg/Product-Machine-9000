import { del } from "@vercel/blob";

const isPublicHttpsUrl = (url: string) => {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
};

export const deleteHostedImages = async (urls: unknown) => {
  if (!Array.isArray(urls)) {
    throw new Error("Inga bildadresser skickades.");
  }

  const hostedUrls = Array.from(
    new Set(urls.filter((url): url is string => typeof url === "string").map((url) => url.trim()).filter(Boolean)),
  );

  if (hostedUrls.length === 0) {
    return { deletedUrls: [] as string[] };
  }

  if (hostedUrls.some((url) => !isPublicHttpsUrl(url))) {
    throw new Error("Endast publika https-adresser kan raderas.");
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN saknas.");
  }

  await del(hostedUrls);
  return { deletedUrls: hostedUrls };
};
