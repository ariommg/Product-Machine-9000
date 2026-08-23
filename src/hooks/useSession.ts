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
import type { AiImageCount, AiImageGenerationResult, AiImageModel, AiProductGenerationResult } from "../types/ai";

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

  const generateImages = useCallback(
    async (id: string, imageModel: AiImageModel, imageCount: AiImageCount) => {
      const product = productsRef.current.find((item) => item.id === id);
      if (!product || product.isGeneratingImages) {
        return;
      }

      updateProduct(id, (current) => ({ ...current, error: "", isGeneratingImages: true }));

      const referenceImageFiles = product.referenceImages
        .filter((image) => product.selectedReferenceImageIds.includes(image.id))
        .map((image) => ({ dataUrl: image.dataUrl, name: image.name }));

      try {
        const aiImages = await requestProductImages({
          aiText: product.aiResult,
          imageCount,
          imageModel,
          product: product.reviewState.rawData,
          referenceImageFiles,
          referenceImageUrls: product.selectedSourceImageUrls,
        });

        updateProduct(id, (current) => {
          const generatedImages: ReviewImageField[] = Object.values(aiImages.images)
            .filter((image): image is NonNullable<typeof image> => Boolean(image))
            .map((image) => ({
              approved: false,
              blobPathname: image.blobPathname,
              hostedUrl: image.hostedUrl,
              hostingError: image.hostingError,
              kind: "ai-generated",
              label: image.label,
              url: image.hostedUrl ?? image.dataUrlOrUrl,
            }));

          return {
            ...current,
            aiImages,
            isGeneratingImages: false,
            reviewState: {
              ...current.reviewState,
              // A new run replaces the previous generated set; source images stay put.
              images: [...current.reviewState.images.filter((image) => image.kind === "source"), ...generatedImages],
            },
          };
        });
      } catch (error) {
        updateProduct(id, (current) => ({
          ...current,
          error: error instanceof Error ? error.message : "Bildgenereringen misslyckades.",
          isGeneratingImages: false,
        }));
      }
    },
    [updateProduct],
  );

  const exportableDrafts = useMemo(
    () =>
      products
        .filter((product) => requiredFieldsApproved(product.reviewState))
        .map((product) => buildApprovedDraft(product.reviewState)),
    [products],
  );

  const hostedImageUrls = useMemo(
    () =>
      Array.from(
        new Set(
          products.flatMap((product) =>
            product.reviewState.images
              .filter((image) => image.kind === "ai-generated" && image.hostedUrl)
              .map((image) => image.hostedUrl as string),
          ),
        ),
      ),
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
    hostedImageUrls,
    importError,
    isImporting,
    products,
  };
};
