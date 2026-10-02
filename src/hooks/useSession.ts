import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestProductImages, requestProductText, requestVariantImages } from "../lib/api";
import { isHtmlFile, readFileAsText } from "../lib/fileImport";
import { isPublicShopifyImageUrl } from "../lib/shopifyCsv";
import { parseSupplierHtmlFile } from "../html/supplierHtmlParser";
import {
  buildApprovedDraft,
  buildReviewState,
  createManualSpecification,
  isBlockedSpecification,
  isReadyForExport,
  mainHeroImage,
  mainVariantValue,
  sortGeneratedImages,
  variantReference,
  visualOption,
  type ProductReviewState,
  type ReferenceFile,
  type ReviewImageField,
  type ReviewSpecificationField,
  type ReviewTextFieldKey,
  type ReviewVariantOption,
  type ReviewVariantValue,
} from "../review/reviewWorkflow";
import { AI_IMAGE_KINDS, AI_IMAGE_LABELS, imageKindsForCount } from "../types/ai";
import type {
  AiImageCount,
  AiImageGenerationResult,
  AiImageKind,
  AiImageModel,
  AiProductGenerationResult,
  VariantImageFailure,
  VariantImageTarget,
} from "../types/ai";

export type UserReferenceImage = {
  dataUrl: string;
  id: string;
  name: string;
  origin: "Inklistrad" | "Släppt" | "Uppladdad";
};

export type SessionProduct = {
  aiImages: AiImageGenerationResult | null;
  aiResult: AiProductGenerationResult | null;
  /** Errors live per product so one failure cannot wipe another product's message. */
  error: string;
  fileName: string;
  /** Colours whose hero is being generated right now, for per-colour spinners. */
  generatingVariantIds: string[];
  id: string;
  isGeneratingImages: boolean;
  isGeneratingText: boolean;
  referenceImages: UserReferenceImage[];
  /** Kinds currently being regenerated on their own, for per-image spinners. */
  regeneratingKinds: AiImageKind[];
  reviewState: ProductReviewState;
  selectedReferenceImageIds: string[];
  selectedSourceImageUrls: string[];
  /** Set while waiting out OpenAI's per-minute image limit before retrying the rest. */
  rateLimitWait: RateLimitWait | null;
  /** Colours whose hero could not be generated in the last run, with the reason. */
  variantImageFailures: VariantImageFailure[];
};

export type RateLimitWait = { imageCount: number; seconds: number; startedAt: number };

/**
 * Image limits are per minute, so each round gets a few more images through.
 * Enough rounds for a few dozen colours on the lowest tier, but not forever.
 */
const MAX_RATE_LIMIT_ROUNDS = 10;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The longest wait OpenAI asked for among the rate-limited images. */
const longestWait = (failures: Array<{ retryAfterSeconds: number | null }>) =>
  Math.max(...failures.map((failure) => failure.retryAfterSeconds ?? 0));

let idCounter = 0;
const nextId = (prefix: string) => {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
};

export const MAX_REFERENCE_IMAGES = 16;

export const useSession = () => {
  const [products, setProducts] = useState<SessionProduct[]>([]);
  const [activeProductId, setActiveProductId] = useState("");
  const [importError, setImportError] = useState("");
  // Every hosted URL created this session, so cleanup also catches replaced images.
  const [hostedImageHistory, setHostedImageHistory] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  // Async handlers need the latest products without re-creating every callback.
  const productsRef = useRef(products);
  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  const activeProduct = products.find((product) => product.id === activeProductId) ?? products[0] ?? null;

  const updateProduct = useCallback((id: string, updater: (product: SessionProduct) => SessionProduct) => {
    setProducts((current) => current.map((product) => (product.id === id ? updater(product) : product)));
  }, []);

  const updateReview = useCallback(
    (id: string, updater: (reviewState: ProductReviewState) => ProductReviewState) => {
      updateProduct(id, (product) => ({ ...product, reviewState: updater(product.reviewState) }));
    },
    [updateProduct],
  );

  const importFiles = useCallback(async (files: File[]) => {
    const htmlFiles = files.filter(isHtmlFile);
    if (htmlFiles.length === 0) {
      setImportError("Inga HTML-filer hittades. Spara produktsidan med Ctrl+S och släpp .html-filen här.");
      return;
    }

    setImportError("");
    setIsImporting(true);

    const imported: SessionProduct[] = [];
    const failedFileNames: string[] = [];

    for (const file of htmlFiles) {
      try {
        const html = await readFileAsText(file);
        const rawData = parseSupplierHtmlFile({ fileName: file.name, html });
        imported.push({
          aiImages: null,
          aiResult: null,
          error: "",
          fileName: file.name,
          generatingVariantIds: [],
          id: nextId("product"),
          rateLimitWait: null,
          isGeneratingImages: false,
          isGeneratingText: false,
          referenceImages: [],
          regeneratingKinds: [],
          reviewState: buildReviewState(rawData),
          selectedReferenceImageIds: [],
          // The first source image is the most useful default AI reference, unless
          // the product has colour swatches: then the main colour's swatch is used
          // automatically, and a gallery photo may well show a different colour.
          selectedSourceImageUrls: rawData.variantOptions.some(
            (option) => option.visual && option.values.some((value) => value.imageUrl),
          )
            ? []
            : rawData.imageUrls.slice(0, 1),
          variantImageFailures: [],
        });
      } catch {
        failedFileNames.push(file.name);
      }
    }

    setIsImporting(false);

    if (failedFileNames.length > 0) {
      setImportError(`Kunde inte läsa: ${failedFileNames.join(", ")}.`);
    }

    if (imported.length > 0) {
      setProducts((current) => [...current, ...imported]);
      setActiveProductId((current) => current || imported[0].id);
    }
  }, []);

  const removeProduct = useCallback((id: string) => {
    setProducts((current) => {
      const remaining = current.filter((product) => product.id !== id);
      setActiveProductId((activeId) => (activeId === id ? (remaining[0]?.id ?? "") : activeId));
      return remaining;
    });
  }, []);

  const clearSession = useCallback(() => {
    setProducts([]);
    setActiveProductId("");
    setImportError("");
  }, []);

  const updateTextField = useCallback(
    (id: string, key: ReviewTextFieldKey, value: string) => {
      updateReview(id, (reviewState) => ({
        ...reviewState,
        fields: reviewState.fields.map((field) =>
          // Editing a field un-approves it so a change can never slip through approved.
          field.key === key ? { ...field, approved: false, status: value.trim() ? "needs-review" : "missing", value } : field,
        ),
      }));
    },
    [updateReview],
  );

  const toggleTextFieldApproval = useCallback(
    (id: string, key: ReviewTextFieldKey) => {
      updateReview(id, (reviewState) => ({
        ...reviewState,
        fields: reviewState.fields.map((field) =>
          field.key === key ? { ...field, approved: !field.approved && Boolean(field.value.trim()) } : field,
        ),
      }));
    },
    [updateReview],
  );

  const approveAllTextFields = useCallback(
    (id: string) => {
      updateReview(id, (reviewState) => ({
        ...reviewState,
        fields: reviewState.fields.map((field) => ({ ...field, approved: Boolean(field.value.trim()) })),
      }));
    },
    [updateReview],
  );

  /** New rows go to the top, directly under the button that created them. */
  const addSpecification = useCallback(
    (id: string) => {
      const specification = createManualSpecification();
      updateReview(id, (reviewState) => ({
        ...reviewState,
        specifications: [specification, ...reviewState.specifications],
      }));
      return specification.id;
    },
    [updateReview],
  );

  const updateSpecification = useCallback(
    (id: string, specificationId: string, patch: Partial<ReviewSpecificationField>) => {
      updateReview(id, (reviewState) => ({
        ...reviewState,
        specifications: reviewState.specifications.map((specification) =>
          specification.id === specificationId ? { ...specification, ...patch } : specification,
        ),
      }));
    },
    [updateReview],
  );

  const removeSpecification = useCallback(
    (id: string, specificationId: string) => {
      updateReview(id, (reviewState) => ({
        ...reviewState,
        specifications: reviewState.specifications.filter((specification) => specification.id !== specificationId),
      }));
    },
    [updateReview],
  );

  const toggleSpecificationApproval = useCallback(
    (id: string, specificationId: string) => {
      updateReview(id, (reviewState) => ({
        ...reviewState,
        specifications: reviewState.specifications.map((specification) =>
          specification.id === specificationId
            ? {
                ...specification,
                approved:
                  !specification.approved &&
                  Boolean(specification.name.trim() && specification.value.trim()) &&
                  !isBlockedSpecification(specification),
              }
            : specification,
        ),
      }));
    },
    [updateReview],
  );

  const approveAllSpecifications = useCallback(
    (id: string) => {
      updateReview(id, (reviewState) => {
        const shouldApprove = !reviewState.specifications
          .filter((specification) => specification.name.trim() && specification.value.trim())
          .every((specification) => specification.approved);

        return {
          ...reviewState,
          specifications: reviewState.specifications.map((specification) => ({
            ...specification,
            approved:
              shouldApprove &&
              Boolean(specification.name.trim() && specification.value.trim()) &&
              !isBlockedSpecification(specification),
          })),
        };
      });
    },
    [updateReview],
  );

  const toggleGeneratedImageApproval = useCallback(
    (id: string, url: string) => {
      updateReview(id, (reviewState) => ({
        ...reviewState,
        images: reviewState.images.map((image) =>
          image.url === url && image.kind === "ai-generated"
            ? { ...image, approved: !image.approved && isPublicShopifyImageUrl(image.url) }
            : image,
        ),
      }));
    },
    [updateReview],
  );

  const toggleAllGeneratedImages = useCallback(
    (id: string) => {
      updateReview(id, (reviewState) => {
        const exportable = reviewState.images.filter(
          (image) => image.kind === "ai-generated" && isPublicShopifyImageUrl(image.url),
        );
        const shouldApprove = exportable.length > 0 && !exportable.every((image) => image.approved);

        return {
          ...reviewState,
          images: reviewState.images.map((image) =>
            image.kind === "ai-generated" && isPublicShopifyImageUrl(image.url)
              ? { ...image, approved: shouldApprove }
              : image,
          ),
        };
      });
    },
    [updateReview],
  );

  const toggleSourceReference = useCallback(
    (id: string, url: string) => {
      updateProduct(id, (product) => ({
        ...product,
        selectedSourceImageUrls: product.selectedSourceImageUrls.includes(url)
          ? product.selectedSourceImageUrls.filter((item) => item !== url)
          : [...product.selectedSourceImageUrls, url],
      }));
    },
    [updateProduct],
  );

  const toggleUserReference = useCallback(
    (id: string, referenceId: string) => {
      updateProduct(id, (product) => ({
        ...product,
        selectedReferenceImageIds: product.selectedReferenceImageIds.includes(referenceId)
          ? product.selectedReferenceImageIds.filter((item) => item !== referenceId)
          : [...product.selectedReferenceImageIds, referenceId],
      }));
    },
    [updateProduct],
  );

  const addReferenceImages = useCallback(
    (id: string, images: Array<{ dataUrl: string; name: string; origin: UserReferenceImage["origin"] }>) => {
      updateProduct(id, (product) => {
        const added = images.map((image) => ({ ...image, id: nextId("reference") }));
        return {
          ...product,
          referenceImages: [...product.referenceImages, ...added],
          // Newly added references are selected straight away, which is what you want.
          selectedReferenceImageIds: [...product.selectedReferenceImageIds, ...added.map((image) => image.id)],
        };
      });
    },
    [updateProduct],
  );

  const removeReferenceImage = useCallback(
    (id: string, referenceId: string) => {
      updateProduct(id, (product) => ({
        ...product,
        referenceImages: product.referenceImages.filter((image) => image.id !== referenceId),
        selectedReferenceImageIds: product.selectedReferenceImageIds.filter((item) => item !== referenceId),
      }));
    },
    [updateProduct],
  );

  /** A name the AI changes is un-approved, exactly like a name you edit yourself. */
  const applyAiOptionNames = (options: ReviewVariantOption[], aiResult: AiProductGenerationResult) =>
    options.map((option) => {
      const named = aiResult.options.find((item) => item.id === option.id);
      if (!named) {
        return option;
      }
      const optionName = named.name.trim() || option.name;
      return {
        ...option,
        approved: option.approved && optionName === option.name,
        name: optionName,
        values: option.values.map((value) => {
          const valueName = named.values.find((item) => item.id === value.id)?.name.trim() || value.name;
          return { ...value, approved: value.approved && valueName === value.name, name: valueName };
        }),
      };
    });

  const applyAiText = (product: SessionProduct, aiResult: AiProductGenerationResult): SessionProduct => {
    const manualSpecifications = product.reviewState.specifications.filter((specification) => specification.manual);
    const aiSpecifications = aiResult.specs.map(
      (spec): ReviewSpecificationField => ({
        approved: false,
        id: nextId("spec"),
        manual: false,
        name: spec.name,
        source: `AI (${spec.confidence})`,
        value: spec.value,
      }),
    );

    return {
      ...product,
      aiResult,
      error: "",
      isGeneratingText: false,
      reviewState: {
        ...product.reviewState,
        fields: product.reviewState.fields.map((field) => {
          const value = field.key === "title" ? aiResult.title : aiResult.description;
          return value ? { ...field, approved: false, status: "needs-review", value } : field;
        }),
        specifications: [...aiSpecifications, ...manualSpecifications],
        variants: applyAiOptionNames(product.reviewState.variants, aiResult),
      },
    };
  };

  const generateText = useCallback(
    async (id: string) => {
      const product = productsRef.current.find((item) => item.id === id);
      if (!product || product.isGeneratingText) {
        return;
      }

      updateProduct(id, (current) => ({ ...current, error: "", isGeneratingText: true }));

      try {
        const aiResult = await requestProductText(product.reviewState.rawData);
        updateProduct(id, (current) => applyAiText(current, aiResult));
      } catch (error) {
        updateProduct(id, (current) => ({
          ...current,
          error: error instanceof Error ? error.message : "Textgenereringen misslyckades.",
          isGeneratingText: false,
        }));
      }
    },
    [updateProduct],
  );

  const toReviewImages = (aiImages: AiImageGenerationResult, mainValueId: string | null): ReviewImageField[] =>
    AI_IMAGE_KINDS.flatMap((imageKind) => {
      const image = aiImages.images[imageKind];
      if (!image) {
        return [];
      }
      return [
        {
          approved: false,
          blobPathname: image.blobPathname,
          hostedUrl: image.hostedUrl,
          hostingError: image.hostingError,
          imageKind,
          kind: "ai-generated" as const,
          label: image.label,
          url: image.hostedUrl ?? image.dataUrlOrUrl,
          variantValueId: mainValueId,
          variantHero: false,
        },
      ];
    });

  const runImageGeneration = useCallback(
    async (id: string, imageModel: AiImageModel, kinds: AiImageKind[], mode: "replace" | "merge") => {
      const product = productsRef.current.find((item) => item.id === id);
      if (!product || product.isGeneratingImages || kinds.length === 0) {
        return;
      }
      if (mode === "merge" && kinds.some((kind) => product.regeneratingKinds.includes(kind))) {
        return;
      }

      // Busy flags stay on through every retry round, so a second run cannot start mid-wait.
      updateProduct(id, (current) => ({
        ...current,
        error: "",
        isGeneratingImages: mode === "replace",
        regeneratingKinds: mode === "merge" ? [...current.regeneratingKinds, ...kinds] : current.regeneratingKinds,
      }));

      const referenceImageFiles = product.referenceImages
        .filter((image) => product.selectedReferenceImageIds.includes(image.id))
        .map((image) => ({ dataUrl: image.dataUrl, name: image.name }));

      // The main colour's own swatch always goes along, so the set comes out in
      // that colour rather than whichever colour the gallery photos happen to show.
      const mainValue = mainVariantValue(product.reviewState);
      const mainReference = mainValue ? variantReference(mainValue) : null;
      const referenceImageUrls = [...product.selectedSourceImageUrls];
      if (mainReference?.file) {
        referenceImageFiles.push(mainReference.file);
      } else if (mainReference?.url && !referenceImageUrls.includes(mainReference.url)) {
        referenceImageUrls.push(mainReference.url);
      }

      let pendingKinds = kinds;
      const failedMessages: string[] = [];

      try {
        for (let round = 0; pendingKinds.length > 0; round += 1) {
          const requestedKinds = pendingKinds;
          const aiImages = await requestProductImages({
            aiText: product.aiResult,
            imageModel,
            kinds: requestedKinds,
            product: product.reviewState.rawData,
            referenceImageFiles,
            referenceImageUrls,
          });

          const generatedImages = toReviewImages(aiImages, mainValue?.id ?? null);
          // Remember every hosted URL, including ones a regeneration replaced, so
          // cleanup can still reach images that are no longer on screen.
          setHostedImageHistory((current) =>
            Array.from(new Set([...current, ...generatedImages.map((image) => image.hostedUrl).filter((url): url is string => Boolean(url))])),
          );

          // A full run clears the old set on its first round only; retries add to it.
          const clearsSet = mode === "replace" && round === 0;
          updateProduct(id, (current) => {
            const sourceImages = current.reviewState.images.filter((image) => image.kind === "source");
            // Extra-colour heroes survive a new main set; regenerate them one by one if needed.
            const keptGenerated = current.reviewState.images.filter(
              (image) =>
                image.kind === "ai-generated" &&
                (image.variantHero || (!clearsSet && !requestedKinds.includes(image.imageKind as AiImageKind))),
            );

            // Re-sort into canonical order so a regenerated image keeps its place.
            const generated = sortGeneratedImages(current.reviewState, [...keptGenerated, ...generatedImages]);

            return {
              ...current,
              aiImages,
              reviewState: { ...current.reviewState, images: [...sourceImages, ...generated] },
            };
          });

          const rateLimited = aiImages.failedKinds.filter((failure) => failure.retryAfterSeconds !== null);
          failedMessages.push(
            ...aiImages.failedKinds
              .filter((failure) => failure.retryAfterSeconds === null)
              .map((failure) => `${AI_IMAGE_LABELS[failure.kind]}: ${failure.reason}`),
          );

          if (rateLimited.length === 0) {
            break;
          }
          if (round + 1 >= MAX_RATE_LIMIT_ROUNDS) {
            failedMessages.push(
              `OpenAI:s bildgräns nåddes för många gånger. Generera om ${rateLimited
                .map((failure) => AI_IMAGE_LABELS[failure.kind].toLowerCase())
                .join(", ")} senare.`,
            );
            break;
          }

          pendingKinds = rateLimited.map((failure) => failure.kind);
          const seconds = longestWait(rateLimited);
          updateProduct(id, (current) => ({
            ...current,
            rateLimitWait: { imageCount: pendingKinds.length, seconds, startedAt: Date.now() },
          }));
          await wait(seconds * 1000);
          if (!productsRef.current.some((item) => item.id === id)) {
            return;
          }
          updateProduct(id, (current) => ({ ...current, rateLimitWait: null }));
        }
      } catch (error) {
        failedMessages.push(error instanceof Error ? error.message : "Bildgenereringen misslyckades.");
      }

      updateProduct(id, (current) => ({
        ...current,
        error: failedMessages.join(" "),
        isGeneratingImages: false,
        rateLimitWait: null,
        regeneratingKinds: current.regeneratingKinds.filter((kind) => !kinds.includes(kind)),
      }));
    },
    [updateProduct],
  );

  const generateImages = useCallback(
    (id: string, imageModel: AiImageModel, imageCount: AiImageCount) =>
      runImageGeneration(id, imageModel, imageKindsForCount(imageCount), "replace"),
    [runImageGeneration],
  );

  /** One OpenAI call instead of a full set, for when only one shot came out wrong. */
  const regenerateImage = useCallback(
    (id: string, imageModel: AiImageModel, kind: AiImageKind) =>
      runImageGeneration(id, imageModel, [kind], "merge"),
    [runImageGeneration],
  );

  const updateVariants = useCallback(
    (id: string, updater: (options: ReviewVariantOption[]) => ReviewVariantOption[]) => {
      updateReview(id, (reviewState) => ({ ...reviewState, variants: updater(reviewState.variants) }));
    },
    [updateReview],
  );

  const updateVariantValue = useCallback(
    (id: string, optionId: string, valueId: string, updater: (value: ReviewVariantValue) => ReviewVariantValue) => {
      updateVariants(id, (options) =>
        options.map((option) =>
          option.id === optionId
            ? { ...option, values: option.values.map((value) => (value.id === valueId ? updater(value) : value)) }
            : option,
        ),
      );
    },
    [updateVariants],
  );

  const renameVariantOption = useCallback(
    (id: string, optionId: string, name: string) => {
      updateVariants(id, (options) =>
        options.map((option) => (option.id === optionId ? { ...option, approved: false, name } : option)),
      );
    },
    [updateVariants],
  );

  const toggleVariantOptionApproval = useCallback(
    (id: string, optionId: string) => {
      updateVariants(id, (options) =>
        options.map((option) =>
          option.id === optionId ? { ...option, approved: !option.approved && Boolean(option.name.trim()) } : option,
        ),
      );
    },
    [updateVariants],
  );

  const renameVariantValue = useCallback(
    (id: string, optionId: string, valueId: string, name: string) => {
      updateVariantValue(id, optionId, valueId, (value) => ({ ...value, approved: false, name }));
    },
    [updateVariantValue],
  );

  const toggleVariantValueApproval = useCallback(
    (id: string, optionId: string, valueId: string) => {
      updateVariantValue(id, optionId, valueId, (value) => ({
        ...value,
        approved: !value.approved && Boolean(value.name.trim()),
      }));
    },
    [updateVariantValue],
  );

  const toggleAllVariantValues = useCallback(
    (id: string, optionId: string) => {
      updateVariants(id, (options) =>
        options.map((option) => {
          if (option.id !== optionId) {
            return option;
          }
          const named = option.values.filter((value) => value.name.trim());
          const shouldApprove = !named.every((value) => value.approved);
          return {
            ...option,
            values: option.values.map((value) => ({ ...value, approved: shouldApprove && Boolean(value.name.trim()) })),
          };
        }),
      );
    },
    [updateVariants],
  );

  const setMainVariantValue = useCallback(
    (id: string, valueId: string) => {
      updateReview(id, (reviewState) => ({ ...reviewState, mainVariantValueId: valueId }));
    },
    [updateReview],
  );

  const setVariantReference = useCallback(
    (id: string, optionId: string, valueId: string, reference: ReferenceFile | null) => {
      updateVariantValue(id, optionId, valueId, (value) => ({ ...value, customReference: reference }));
    },
    [updateVariantValue],
  );

  /**
   * One hero per extra colour, matched to the main colour's hero. Also used to
   * regenerate a single colour, which replaces only that colour's hero.
   */
  const generateVariantImages = useCallback(
    async (id: string, imageModel: AiImageModel, valueIds: string[]) => {
      const product = productsRef.current.find((item) => item.id === id);
      const option = product ? visualOption(product.reviewState) : null;
      if (!product || !option) {
        return;
      }

      const base = mainHeroImage(product.reviewState);
      if (!base?.hostedUrl) {
        updateProduct(id, (current) => ({
          ...current,
          error: "Generera huvudfärgens bilder först. De andra färgerna utgår från dess huvudbild.",
        }));
        return;
      }

      const targets: VariantImageTarget[] = option.values
        .filter(
          (value) =>
            valueIds.includes(value.id) &&
            value.id !== base.variantValueId &&
            !product.generatingVariantIds.includes(value.id),
        )
        .flatMap((value) => {
          const reference = variantReference(value);
          return reference
            ? [
                {
                  name: value.name.trim() || value.supplierName,
                  referenceFile: reference.file,
                  referenceUrl: reference.url,
                  valueId: value.id,
                },
              ]
            : [];
        });

      if (targets.length === 0) {
        return;
      }

      const targetIds = targets.map((target) => target.valueId);

      updateProduct(id, (current) => ({
        ...current,
        error: "",
        generatingVariantIds: [...current.generatingVariantIds, ...targetIds],
        variantImageFailures: current.variantImageFailures.filter((failure) => !targetIds.includes(failure.valueId)),
      }));

      let pendingTargets = targets;
      const failures: VariantImageFailure[] = [];
      let errorMessage = "";

      try {
        for (let round = 0; pendingTargets.length > 0; round += 1) {
          const result = await requestVariantImages({
            aiText: product.aiResult,
            baseImageUrl: base.hostedUrl,
            imageModel,
            product: product.reviewState.rawData,
            targets: pendingTargets,
          });

          const newImages: ReviewImageField[] = Object.entries(result.images).map(([valueId, image]) => ({
            approved: false,
            blobPathname: image.blobPathname,
            hostedUrl: image.hostedUrl,
            hostingError: image.hostingError,
            imageKind: "hero",
            kind: "ai-generated",
            label: image.label,
            url: image.hostedUrl ?? image.dataUrlOrUrl,
            variantValueId: valueId,
            variantHero: true,
          }));

          setHostedImageHistory((current) =>
            Array.from(
              new Set([...current, ...newImages.map((image) => image.hostedUrl).filter((url): url is string => Boolean(url))]),
            ),
          );

          // Each colour's spinner stops as soon as its own image lands.
          const finishedIds = [
            ...Object.keys(result.images),
            ...result.failures.filter((failure) => failure.retryAfterSeconds === null).map((failure) => failure.valueId),
          ];

          updateProduct(id, (current) => {
            const replacedIds = Object.keys(result.images);
            const sourceImages = current.reviewState.images.filter((image) => image.kind === "source");
            const keptGenerated = current.reviewState.images.filter(
              (image) =>
                image.kind === "ai-generated" &&
                !(image.variantHero && replacedIds.includes(image.variantValueId ?? "")),
            );

            return {
              ...current,
              generatingVariantIds: current.generatingVariantIds.filter((valueId) => !finishedIds.includes(valueId)),
              reviewState: {
                ...current.reviewState,
                images: [...sourceImages, ...sortGeneratedImages(current.reviewState, [...keptGenerated, ...newImages])],
              },
            };
          });

          const rateLimited = result.failures.filter((failure) => failure.retryAfterSeconds !== null);
          failures.push(...result.failures.filter((failure) => failure.retryAfterSeconds === null));

          if (rateLimited.length === 0) {
            break;
          }
          if (round + 1 >= MAX_RATE_LIMIT_ROUNDS) {
            failures.push(
              ...rateLimited.map((failure) => ({
                ...failure,
                reason: "OpenAI:s bildgräns nåddes för många gånger, försök igen senare",
              })),
            );
            break;
          }

          const limitedIds = rateLimited.map((failure) => failure.valueId);
          pendingTargets = pendingTargets.filter((target) => limitedIds.includes(target.valueId));
          const seconds = longestWait(rateLimited);
          updateProduct(id, (current) => ({
            ...current,
            rateLimitWait: { imageCount: pendingTargets.length, seconds, startedAt: Date.now() },
          }));
          await wait(seconds * 1000);
          if (!productsRef.current.some((item) => item.id === id)) {
            return;
          }
          updateProduct(id, (current) => ({ ...current, rateLimitWait: null }));
        }
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : "Färgbilderna kunde inte genereras.";
      }

      updateProduct(id, (current) => ({
        ...current,
        error: errorMessage,
        generatingVariantIds: current.generatingVariantIds.filter((valueId) => !targetIds.includes(valueId)),
        rateLimitWait: null,
        variantImageFailures: [...current.variantImageFailures, ...failures],
      }));
    },
    [updateProduct],
  );

  const exportableDrafts = useMemo(
    () =>
      products
        .filter((product) => isReadyForExport(product.reviewState))
        .map((product) => buildApprovedDraft(product.reviewState)),
    [products],
  );

  return {
    actions: {
      addReferenceImages,
      addSpecification,
      approveAllSpecifications,
      approveAllTextFields,
      clearSession,
      generateImages,
      generateText,
      generateVariantImages,
      importFiles,
      regenerateImage,
      removeProduct,
      removeReferenceImage,
      removeSpecification,
      renameVariantOption,
      renameVariantValue,
      setActiveProductId,
      setMainVariantValue,
      setVariantReference,
      toggleAllGeneratedImages,
      toggleAllVariantValues,
      toggleGeneratedImageApproval,
      toggleSourceReference,
      toggleSpecificationApproval,
      toggleTextFieldApproval,
      toggleUserReference,
      toggleVariantOptionApproval,
      toggleVariantValueApproval,
      updateSpecification,
      updateTextField,
    },
    activeProduct,
    exportableDrafts,
    hostedImageHistory,
    importError,
    isImporting,
    products,
  };
};
