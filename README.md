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

The CSV uses the column set that imports cleanly into Shopify today, plus one metafield column for the specifications. Do not reorder or extend `SHOPIFY_CSV_HEADERS` without re-testing a real import first.

### Specifications metafield

Approved specifications go into a product metafield rather than the description, so the description stays pure marketing copy.

The column is `Specifikationer (product.metafields.custom.specifikationer)`. Set `VITE_SPECS_METAFIELD` to `namespace.key` if yours differs — you can find it under **Settings > Custom data > Products** in Shopify.

**The definition in Shopify must be type "Multi-line text".** Shopify's CSV importer only accepts plain metafield types; `rich_text_field` is not among the supported types, because rich text stores a nested JSON document rather than text. A rich text definition will not be populated by this export.

The value is one `Namn: Värde` per line. Themes render multi-line text with a line break per line.

Specifications are only visible on your storefront if your theme renders that metafield. Add it through the theme editor, or via a metafield dynamic source on a rich text block.

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

Generated images are uploaded to Vercel Blob so Shopify can download them during import.

**They expire after 7 days** (`HOSTED_IMAGE_TTL_DAYS`), which means you can export today and import into Shopify a day or two later without the images going missing. Nothing is deleted when you close the tab.

Two things sweep expired images, and both only ever delete what is already past the TTL:

- A daily Vercel Cron job on `/api/cleanup-expired-images`, configured in `vercel.json`.
- An opportunistic sweep when the app is opened, so cleanup still happens when running locally where there is no cron.

A **Rensa hostade bilder** button is still there after export if you want the space back immediately.

### Stored format

OpenAI returns PNG. Shopify accepts JPEG, PNG and WebP and re-encodes everything for delivery, so what is stored here is only the master Shopify downloads once.

`GENERATED_IMAGE_FORMAT` picks how that master is stored:

| Mode | Format | Per image | Per product | Products per GB | Loss vs the model output |
| --- | --- | --- | --- | --- | --- |
| `jpeg` (default) | JPEG q95 | ~220 KB | ~0.9 MB | ~1,200 | RMSE 0.82, worst channel 11/255 |
| `lossless` | WebP lossless | ~863 KB | ~3.4 MB | ~300 | none, bit-exact |
| — | PNG, unconverted | ~1.4 MB | ~5.4 MB | ~190 | none |

Quality defaults to 95 rather than the more usual 88 on purpose. A product on a plain background is a hard edge over a flat area, which is exactly where JPEG ringing shows: at 88 the worst-case channel error at those edges is 33/255, at 95 it is 16/255, for about 20% more bytes.

If you would rather keep exactly what the model produced, set `GENERATED_IMAGE_FORMAT=lossless`. It is still smaller than PNG, and with a 7-day window ~300 products per GB is not a real constraint.

Images with transparency keep an alpha-capable format in both modes, and the re-encode is skipped whenever it would not actually make the file smaller.

## Development

Create `.env` next to `package.json`:

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.4
OPENAI_IMAGE_MODEL=gpt-image-1
OPENAI_IMAGE_QUALITY=medium
OPENAI_IMAGE_SIZE=1024x1024
REFERENCE_IMAGE_MAX_EDGE=768
GENERATED_IMAGE_FORMAT=jpeg
GENERATED_IMAGE_QUALITY=95
HOSTED_IMAGE_TTL_DAYS=7
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

`vercel.json` registers the daily cleanup cron. Set `CRON_SECRET` if you want `/api/cleanup-expired-images` to reject calls that do not come from Vercel Cron; leave it unset to keep the in-app sweep working.

Endpoints:

| Route | Purpose |
| --- | --- |
| `/api/generate-product` | Swedish copy and specifications |
| `/api/generate-images` | Image generation and blob upload |
| `/api/delete-hosted-images` | Immediate cleanup of hosted images you confirm |
| `/api/cleanup-expired-images` | Sweeps images past the TTL. Run daily by cron |
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
