# Project Instructions

Always reply in English. The app's own interface and all generated product copy are in Swedish.

This project is Product Machine 9000.

## What this app is

A single-session tool that turns saved supplier product pages into one Shopify CSV.

It is not a scraper. The user saves the page manually with Ctrl+S and uploads the `.html` file.

## Session model

The session is deliberately memory-only.

- No database, no localStorage, no IndexedDB, no server-side session storage.
- No projects, folders, or saved workspaces.
- Many HTML files per session is the normal case, not an edge case.
- Closing the tab is the end of the session. Warn before it happens and clean up hosted images on the way out.

Do not add persistence unless the user explicitly asks for it.

## Do not reintroduce

- Live scraping of any marketplace
- Playwright or assisted browser extraction
- Metafield CSV columns
- The legacy `products_export.csv` column format
- Any store name, brand, or product category hardcoded in prompts or parsing logic

## Store neutrality

The app is used across several stores. Nothing store-specific belongs in the code.

- No store name in prompts.
- No product-category assumptions. The AI infers the category from the product data.
- No category-specific parsing rules. The parser handles whatever the page contains.
- The CSV leaves Vendor, Product category, Type, and Tags blank so the file imports into any store.

Output language is Swedish and is fixed. Translation happens after import, not here.

## Parser rules

Parse `window.detailData` first when present. Fall back to the DOM only when it is missing, and record that in the extraction notes.

Keep these strictly separated from product specifications, in their own fields:

- Supplier name
- Supplier price and price tiers
- MOQ
- Lead time
- Package dimensions (`trade.logisticInfo.unitSize`)
- Package weight (`trade.logisticInfo.unitWeight`)

Package dimensions are never product dimensions. Package weight is never product weight.

Do not use page title, navbar text, or full page text as primary product data when structured data exists.

## Shopify CSV rules

Keep the current column set. It is the one that imports cleanly.

- Price always `0`
- Status always lowercase `draft`
- SKU, barcode, tags, vendor, product category, type always blank
- Charge tax `FALSE`
- Inventory tracker blank, inventory not tracked
- Supplier price never becomes the Shopify price
- No metafield columns
- Only public `https` image URLs, never base64, blob, or localhost
- Description is emitted as HTML on a single physical line

Changing `SHOPIFY_CSV_HEADERS` requires re-testing a real Shopify import.

## Product copy rules

Swedish, natural, and neutral. Written as if the store sells the product directly.

Never invent dimensions, materials, certifications, capacity, weight, or performance claims. If something is ambiguous it goes in `needsReview`, not in the copy.

Sourcing wording is flagged on the field, not silently deleted. Losing good copy over one stray word is worse than showing a warning, and nothing exports without approval.

## Approval model

Nothing reaches the CSV unless the user ticked Approve on it. This applies to the title, the description, every specification row, and every generated image.

Editing an approved field un-approves it.

## Images

Source images and user-supplied reference images are reference-only and can never be exported.

Only generated images are exportable, and only once they have a public hosted URL.

Reference downloads must use browser-shaped request headers. Marketplace CDNs return an AVIF or a block page to anything that looks automated. Fetch references sequentially, retry connection resets, and sniff the magic bytes rather than trusting the content-type header.

A reference that fails to download is reported per image and does not abort generation.

## Cost

Every generated image is a separate OpenAI call, and each call re-sends every reference image. Reference cost is therefore `referenceCount x imageCount`, and image input is billed on pixel dimensions.

Two things follow, and both must be preserved:

- References are downscaled once, before the fan-out, capped by `REFERENCE_IMAGE_MAX_EDGE` (default 768). Resizing must never throw: a reference that cannot be resized is sent as-is rather than failing the run.
- A single image can be regenerated on its own. Do not replace the whole set when one shot is wrong.

Hosted image URLs are tracked for the whole session, including ones a regeneration replaced, so cleanup can still reach images no longer on screen.

## Hosted image lifetime

Hosted images must outlive the browser tab. The CSV is often imported into Shopify a day or two after export, and deleting on tab close breaks that. Do not reintroduce tab-close deletion.

Images expire after `HOSTED_IMAGE_TTL_DAYS` (default 7), swept by a daily cron and by an opportunistic sweep on app start. Any sweep must only ever delete blobs already past the TTL, so it stays safe to call from anywhere.

Generated images are re-encoded before upload, controlled by `GENERATED_IMAGE_FORMAT`: JPEG q95 by default, WebP lossless when set to `lossless`. Quality 95 is deliberate, not arbitrary — a product on a plain background is a hard edge over a flat area, where JPEG ringing is worst, and 88 leaves a worst-case channel error of 33/255 against 16/255 at 95.

Transparency must keep an alpha-capable format in both modes, the re-encode is skipped when it would not shrink the file, and encoding must never throw: fall back to the original bytes.
