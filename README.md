# Product Machine 9000

Turns saved supplier product pages into a Shopify-ready CSV. One browser session, one batch, one file.

Nothing is stored anywhere. No database, no accounts, no projects, no browser storage. Close the tab and the session is gone.

## Workflow

1. Open a supplier product page in a normal browser and wait for the data and images to load.
2. Save the page with `Ctrl` + `S`.
3. Drop the `.html` files into Product Machine 9000. Several files, or a whole folder, at once.
4. Work through the queue: generate Swedish copy, generate product images, approve what is correct.
5. Export one CSV for every product you approved.
6. Import the CSV into Shopify, confirm the images arrived, then clear the hosted images.

## Rules the export always follows

These are fixed in code, not in the prompt, so the AI cannot talk itself out of them:

- Price is always `0`.
- Status is always lowercase `draft`.
- SKU, barcode, tags, vendor, product category and type are always blank.
- Charge tax is `FALSE`.
- Inventory tracker is blank, so Shopify does not track inventory.
- The supplier's price never becomes the Shopify price.
- Package dimensions never become product dimensions, and package weight never becomes product weight.
- Only images with a public `https` URL reach the CSV. Never base64, blob, or localhost URLs.
- Nothing is exported unless you ticked Approve on it.

The CSV uses the column set that imports cleanly into Shopify today. It has no metafield columns. Do not reorder or extend `SHOPIFY_CSV_HEADERS` without re-testing a real import first.

## Extraction

`window.detailData.globalData` is the primary source. Fields used:

| Field | Used as |
| --- | --- |
| `product.subject` | Title |
| `product.productBasicProperties` | Specifications |
| `product.mediaItems` | Images and videos |
| `product.moq` | Internal only |
| `seller.companyName` | Internal only |
| `product.price.formatLadderPrice` | Internal only |
| `trade.logisticInfo.unitSize` | Package dimensions, internal only |
| `trade.logisticInfo.unitWeight` | Package weight, internal only |

Product detail tables in the page HTML are merged in as extra specifications. If `window.detailData` is missing or unparseable, the parser falls back to the DOM and says so in the extraction notes.

Supplier name, price, MOQ, and logistics are held in separate fields from specifications, and are never sent to the copy AI at all.

## AI text

Server-side only. The browser never sees the OpenAI key.

Generates a Swedish title, a Swedish description, and cleaned specifications. It does not generate SEO fields, tags, category, type, variants, or pricing.

Wording that reveals sourcing (Alibaba, leverantör, fabrik, Kina, dropshipping, MOQ, grossist and similar) is flagged as a warning on the field rather than silently deleted, so you can edit it instead of losing the copy. Nothing exports without approval regardless.

## AI images

Up to four images per product: hero, angled hero, detail, lifestyle. Each image is one OpenAI call, so `calls = 1 text + number of images`.

Every generated image has its own **regenerate** button. If only the lifestyle shot came out wrong, regenerating it costs one call instead of four, and the other three are kept exactly as they were.

Reference images are what keep the generated product looking like the real product:

- Source images from the saved page can be selected with **Använd som referens**. The server downloads them with browser-shaped request headers, which is what makes marketplace CDNs serve the real image.
- If a reference cannot be downloaded, that one reference is reported with a reason and generation continues with the rest. A single dead URL no longer blocks the product.
- You can also paste (`Ctrl` + `V`), drag, or upload your own reference images.
- Up to 16 references total.

Source images and your own reference images are reference-only. They are never exported to Shopify. Only generated images can be exported, and only once they have a public hosted URL.

Reference images increase cost. Image input is billed on pixel dimensions, and **every generated image re-sends every reference**, so the cost is `referenceCount x imageCount`. Two references across four images is eight reference uploads, not two.

To keep that in check, references are downscaled before being sent. The longest edge is capped at `REFERENCE_IMAGE_MAX_EDGE` (default 768 px), which takes a typical 2000 x 1500 supplier photo down to 768 x 576 — about 7x fewer pixels — while keeping enough detail for shape, material, and proportion. Images already under the cap are passed through untouched, and transparency is preserved. Lower the value for cheaper runs, raise it if fine texture is being lost.

## Hosted images

Generated images are uploaded to Vercel Blob so Shopify can download them during import. They do not expire on their own, so they are cleaned up two ways:

- A **Rensa hostade bilder** button appears after export.
- Closing the tab fires an automatic cleanup, since the URLs are unrecoverable once the session ends.

Only clear them after Shopify has imported the images and you can see them in the admin.

## Development

Create `.env` next to `package.json`:

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.4
OPENAI_IMAGE_MODEL=gpt-image-1
OPENAI_IMAGE_QUALITY=medium
OPENAI_IMAGE_SIZE=1024x1024
REFERENCE_IMAGE_MAX_EDGE=768
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
```

Only `OPENAI_API_KEY` is required. `BLOB_READ_WRITE_TOKEN` is required to export generated images. `REFERENCE_IMAGE_MAX_EDGE` is optional and defaults to 768.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build
npm run typecheck
```

## Vercel

Set the same variables in Project Settings. Never add `VITE_OPENAI_API_KEY` — the key must stay server-side.

Endpoints:

| Route | Purpose |
| --- | --- |
| `/api/generate-product` | Swedish copy and specifications |
| `/api/generate-images` | Image generation and blob upload |
| `/api/delete-hosted-images` | Cleanup of hosted images you confirm |
| `/api/image-config` | Non-secret defaults for the UI |

## Layout

```
api/           Serverless endpoints, thin wrappers over server/
server/        OpenAI calls, prompts, reference image fetching and resizing, blob upload
src/html/      Saved-page parser
src/review/    Approval model and approved-draft construction
src/lib/       CSV, formatting, API client, file import
src/hooks/     Session state, tab-close handling
src/components/UI
```
