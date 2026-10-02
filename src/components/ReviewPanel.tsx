import { useState } from "react";
import { AiToolbar } from "./AiToolbar";
import { GeneratedImageSection, ReferenceImageSection, SourceImageSection } from "./ImageSections";
import { Notice } from "./Notice";
import { SpecificationSection } from "./SpecificationSection";
import { TextFieldSection } from "./TextFieldSection";
import { VariantSection } from "./VariantSection";
import { MAX_REFERENCE_IMAGES, type SessionProduct, type useSession } from "../hooks/useSession";
import {
  buildDraftVariants,
  mainHeroImage,
  mainVariantValue,
  variantExportIssues,
  variantHeroImage,
  variantReference,
  visualOption,
} from "../review/reviewWorkflow";
import type { AiImageCount, AiImageKind, AiImageModel } from "../types/ai";

type ReviewPanelProps = {
  actions: ReturnType<typeof useSession>["actions"];
  imageCount: AiImageCount;
  imageModel: AiImageModel;
  onImageCountChange: (imageCount: AiImageCount) => void;
  onImageModelChange: (imageModel: AiImageModel) => void;
  product: SessionProduct;
};

export function ReviewPanel({
  actions,
  imageCount,
  imageModel,
  onImageCountChange,
  onImageModelChange,
  product,
}: ReviewPanelProps) {
  const [focusSpecificationId, setFocusSpecificationId] = useState("");
  const [showSourceData, setShowSourceData] = useState(false);

  const { rawData } = product.reviewState;
  const sourceImages = product.reviewState.images.filter((image) => image.kind === "source");
  const generatedImages = product.reviewState.images.filter((image) => image.kind === "ai-generated");
  const mainValue = mainVariantValue(product.reviewState);
  const mainReference = mainValue ? variantReference(mainValue) : null;
  const mainReferenceIsExtra = Boolean(
    mainReference && (mainReference.file || !product.selectedSourceImageUrls.includes(mainReference.url)),
  );
  const referenceCount =
    product.selectedSourceImageUrls.length + product.selectedReferenceImageIds.length + Number(mainReferenceIsExtra);

  const colourOption = visualOption(product.reviewState);
  const mainHero = mainHeroImage(product.reviewState);
  const heroByValueId = Object.fromEntries(
    (colourOption?.values ?? []).map((value) => [value.id, variantHeroImage(product.reviewState, value.id) ?? undefined]),
  );

  return (
    <div className="review stack">
      <header className="review-header">
        <div>
          <p className="eyebrow">{product.fileName}</p>
          <h2>{product.reviewState.fields[0]?.value || "Namnlös produkt"}</h2>
        </div>
        <button className="button button-ghost" onClick={() => setShowSourceData((current) => !current)} type="button">
          {showSourceData ? "Dölj källdata" : "Visa källdata"}
        </button>
      </header>

      {showSourceData ? (
        <section className="panel source-data">
          <div className="panel-body stack">
            <dl className="source-grid">
              <div>
                <dt>Källa</dt>
                <dd>{rawData.sourceUrl || "Okänd"}</dd>
              </div>
              <div>
                <dt>Leverantör</dt>
                <dd>{rawData.supplierName || "Ej hittad"}</dd>
              </div>
              <div>
                <dt>Inköpspris</dt>
                <dd>{rawData.supplierPrice || "Ej hittat"}</dd>
              </div>
              <div>
                <dt>MOQ</dt>
                <dd>{rawData.minimumOrderQuantity || "Ej hittad"}</dd>
              </div>
              <div>
                <dt>Paketmått</dt>
                <dd>{rawData.packageDimensions || "Ej hittade"}</dd>
              </div>
              <div>
                <dt>Paketvikt</dt>
                <dd>{rawData.packageWeight || "Ej hittad"}</dd>
              </div>
            </dl>
            <p className="source-note">
              Detta är intern data. Den skickas aldrig till AI-texten och hamnar aldrig i Shopify-exporten.
            </p>
            <ul className="source-notes">
              {rawData.extractionNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <AiToolbar
        imageCount={imageCount}
        imageModel={imageModel}
        isGeneratingImages={product.isGeneratingImages}
        isGeneratingText={product.isGeneratingText}
        onGenerateImages={() => void actions.generateImages(product.id, imageModel, imageCount)}
        onGenerateText={() => void actions.generateText(product.id)}
        onImageCountChange={onImageCountChange}
        onImageModelChange={onImageModelChange}
        referenceCount={referenceCount}
      />

      {product.error ? <Notice tone="error">{product.error}</Notice> : null}

      {mainReference && product.selectedSourceImageUrls.length > 0 ? (
        <Notice tone="info">
          Huvudfärgens egen bild ({mainValue?.name || mainValue?.supplierName}) används automatiskt som referens. Valda
          källbilder kan visa en annan färg. Avmarkera dem om bilderna får fel färg.
        </Notice>
      ) : null}

      {product.aiImages?.failedReferences.length ? (
        <Notice tone="warning" title="Vissa referensbilder kunde inte hämtas">
          <ul className="notice-list">
            {product.aiImages.failedReferences.map((failure) => (
              <li key={failure.url}>{failure.reason}</li>
            ))}
          </ul>
          <p>Bilderna genererades med de referenser som gick att hämta. Klistra in bilden manuellt för bästa resultat.</p>
        </Notice>
      ) : null}

      {product.aiResult?.warnings.length ? (
        <Notice tone="warning" title="Kontrollera texten">
          <ul className="notice-list">
            {product.aiResult.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {product.aiResult?.needsReview.length ? (
        <Notice tone="info" title="AI:n flaggade detta">
          <ul className="notice-list">
            {product.aiResult.needsReview.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <TextFieldSection
        fields={product.reviewState.fields}
        onApproveAll={() => actions.approveAllTextFields(product.id)}
        onChange={(key, value) => actions.updateTextField(product.id, key, value)}
        onToggleApproval={(key) => actions.toggleTextFieldApproval(product.id, key)}
      />

      <SpecificationSection
        focusSpecificationId={focusSpecificationId}
        onAdd={() => setFocusSpecificationId(actions.addSpecification(product.id))}
        onApproveAll={() => actions.approveAllSpecifications(product.id)}
        onChange={(specificationId, patch) => actions.updateSpecification(product.id, specificationId, patch)}
        onRemove={(specificationId) => actions.removeSpecification(product.id, specificationId)}
        onToggleApproval={(specificationId) => actions.toggleSpecificationApproval(product.id, specificationId)}
        specifications={product.reviewState.specifications}
      />

      <VariantSection
        baseHeroValueId={mainHero?.variantValueId ?? null}
        exportIssues={variantExportIssues(product.reviewState)}
        failures={product.variantImageFailures}
        generatingValueIds={product.generatingVariantIds}
        hasMainHero={Boolean(mainHero)}
        heroByValueId={heroByValueId}
        mainValueId={product.reviewState.mainVariantValueId}
        onGenerateColours={(valueIds) => void actions.generateVariantImages(product.id, imageModel, valueIds)}
        onRenameOption={(optionId, name) => actions.renameVariantOption(product.id, optionId, name)}
        onRenameValue={(optionId, valueId, name) => actions.renameVariantValue(product.id, optionId, valueId, name)}
        onSetMain={(valueId) => actions.setMainVariantValue(product.id, valueId)}
        onSetReference={(optionId, valueId, reference) =>
          actions.setVariantReference(product.id, optionId, valueId, reference)
        }
        onToggleAll={(optionId) => actions.toggleAllVariantValues(product.id, optionId)}
        onToggleOption={(optionId) => actions.toggleVariantOptionApproval(product.id, optionId)}
        onToggleValue={(optionId, valueId) => actions.toggleVariantValueApproval(product.id, optionId, valueId)}
        options={product.reviewState.variants}
        variantCount={buildDraftVariants(product.reviewState).variants.length}
      />

      <SourceImageSection
        images={sourceImages}
        onToggle={(url) => actions.toggleSourceReference(product.id, url)}
        selectedUrls={product.selectedSourceImageUrls}
      />

      <ReferenceImageSection
        images={product.referenceImages}
        maxImages={MAX_REFERENCE_IMAGES}
        onAdd={(images) => actions.addReferenceImages(product.id, images)}
        onRemove={(referenceId) => actions.removeReferenceImage(product.id, referenceId)}
        onToggle={(referenceId) => actions.toggleUserReference(product.id, referenceId)}
        selectedIds={product.selectedReferenceImageIds}
      />

      <GeneratedImageSection
        images={generatedImages}
        isBusy={(image) =>
          image.variantHero
            ? product.generatingVariantIds.includes(image.variantValueId ?? "")
            : Boolean(image.imageKind && product.regeneratingKinds.includes(image.imageKind))
        }
        onRegenerate={(image) =>
          image.variantHero && image.variantValueId
            ? void actions.generateVariantImages(product.id, imageModel, [image.variantValueId])
            : void actions.regenerateImage(product.id, imageModel, image.imageKind as AiImageKind)
        }
        onToggle={(url) => actions.toggleGeneratedImageApproval(product.id, url)}
        onToggleAll={() => actions.toggleAllGeneratedImages(product.id)}
      />
    </div>
  );
}
