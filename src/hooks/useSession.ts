import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestProductImages, requestProductText } from "../lib/api";
import { isHtmlFile, readFileAsText } from "../lib/fileImport";
import { isPublicShopifyImageUrl } from "../lib/shopifyCsv";
import { parseSupplierHtmlFile } from "../html/supplierHtmlParser";
import {
  buildApprovedDraft,
  buildReviewState,
  createManualSpecification,
  isBlockedSpecification,
  requiredFieldsApproved,
  type ProductReviewState,
  type ReviewImageField,
  type ReviewSpecificationField,
  type ReviewTextFieldKey,
} from "../review/reviewWorkflow";
import { AI_IMAGE_KINDS, imageKindsForCount } from "../types/ai";
import type {
  AiImageCount,
  AiImageGenerationResult,
  AiImageKind,
  AiImageModel,
  AiProductGenerationResult,
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
  id: string;
  isGeneratingImages: boolean;
  isGeneratingText: boolean;
  referenceImages: UserReferenceImage[];
  /** Kinds currently being regenerated on their own, for per-image spinners. */
  regeneratingKinds: AiImageKind[];
  reviewState: ProductReviewState;
  selectedReferenceImageIds: string[];
  selectedSourceImageUrls: string[];
};

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
          id: nextId("product"),
          isGeneratingImages: false,
          isGeneratingText: false,
          referenceImages: [],
          regeneratingKinds: [],
          reviewState: buildReviewState(rawData),
          selectedReferenceImageIds: [],
          // The first source image is the most useful default AI reference.
          selectedSourceImageUrls: rawData.imageUrls.slice(0, 1),
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

  const toReviewImages = (aiImages: AiImageGenerationResult): ReviewImageField[] =>
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

      updateProduct(id, (current) => ({
        ...current,
        error: "",
        isGeneratingImages: mode === "replace",
        regeneratingKinds: mode === "merge" ? [...current.regeneratingKinds, ...kinds] : current.regeneratingKinds,
      }));

      const referenceImageFiles = product.referenceImages
        .filter((image) => product.selectedReferenceImageIds.includes(image.id))
        .map((image) => ({ dataUrl: image.dataUrl, name: image.name }));

      try {
        const aiImages = await requestProductImages({
          aiText: product.aiResult,
          imageModel,
          kinds,
          product: product.reviewState.rawData,
          referenceImageFiles,
          referenceImageUrls: product.selectedSourceImageUrls,
        });

        const generatedImages = toReviewImages(aiImages);
        // Remember every hosted URL, including ones a regeneration replaced, so
        // cleanup can still reach images that are no longer on screen.
        setHostedImageHistory((current) =>
          Array.from(new Set([...current, ...generatedImages.map((image) => image.hostedUrl).filter((url): url is string => Boolean(url))])),
        );

        updateProduct(id, (current) => {
          const sourceImages = current.reviewState.images.filter((image) => image.kind === "source");
          const keptGenerated =
            mode === "merge"
              ? current.reviewState.images.filter(
                  (image) => image.kind === "ai-generated" && !kinds.includes(image.imageKind as AiImageKind),
                )
              : [];

          // Re-sort into canonical shot order so a regenerated image keeps its place.
          const generated = [...keptGenerated, ...generatedImages].sort(
            (left, right) =>
              AI_IMAGE_KINDS.indexOf(left.imageKind as AiImageKind) -
              AI_IMAGE_KINDS.indexOf(right.imageKind as AiImageKind),
          );

          return {
            ...current,
            aiImages,
            isGeneratingImages: false,
            regeneratingKinds: current.regeneratingKinds.filter((kind) => !kinds.includes(kind)),
            reviewState: { ...current.reviewState, images: [...sourceImages, ...generated] },
          };
        });
      } catch (error) {
        updateProduct(id, (current) => ({
          ...current,
          error: error instanceof Error ? error.message : "Bildgenereringen misslyckades.",
          isGeneratingImages: false,
          regeneratingKinds: current.regeneratingKinds.filter((kind) => !kinds.includes(kind)),
        }));
      }
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

  const exportableDrafts = useMemo(
    () =>
      products
        .filter((product) => requiredFieldsApproved(product.reviewState))
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
      importFiles,
      regenerateImage,
      removeProduct,
      removeReferenceImage,
      removeSpecification,
      setActiveProductId,
      toggleAllGeneratedImages,
      toggleGeneratedImageApproval,
      toggleSourceReference,
      toggleSpecificationApproval,
      toggleTextFieldApproval,
      toggleUserReference,
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
