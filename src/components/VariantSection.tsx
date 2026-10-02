import { Check, ImageOff, ImagePlus, Images, Loader2, Star, X } from "lucide-react";
import { useRef, type ChangeEvent, type ClipboardEvent } from "react";
import { Notice } from "./Notice";
import { isReferenceImageFile, readFileAsDataUrl } from "../lib/fileImport";
import {
  variantReference,
  type ReferenceFile,
  type ReviewImageField,
  type ReviewVariantOption,
  type ReviewVariantValue,
} from "../review/reviewWorkflow";
import type { VariantImageFailure } from "../types/ai";

type VariantSectionProps = {
  /** Colour of the hosted main hero, or null when there is none yet. */
  baseHeroValueId: string | null;
  exportIssues: string[];
  failures: VariantImageFailure[];
  generatingValueIds: string[];
  hasMainHero: boolean;
  /** Hero image per colour, for the per-colour status line. */
  heroByValueId: Record<string, ReviewImageField | undefined>;
  mainValueId: string;
  onGenerateColours: (valueIds: string[]) => void;
  onRenameOption: (optionId: string, name: string) => void;
  onRenameValue: (optionId: string, valueId: string, name: string) => void;
  onSetMain: (valueId: string) => void;
  onSetReference: (optionId: string, valueId: string, reference: ReferenceFile | null) => void;
  onToggleAll: (optionId: string) => void;
  onToggleOption: (optionId: string) => void;
  onToggleValue: (optionId: string, valueId: string) => void;
  options: ReviewVariantOption[];
  variantCount: number;
};

export function VariantSection({
  baseHeroValueId,
  exportIssues,
  failures,
  generatingValueIds,
  hasMainHero,
  heroByValueId,
  mainValueId,
  onGenerateColours,
  onRenameOption,
  onRenameValue,
  onSetMain,
  onSetReference,
  onToggleAll,
  onToggleOption,
  onToggleValue,
  options,
  variantCount,
}: VariantSectionProps) {
  if (options.length === 0) {
    return null;
  }

  const visual = options.find((option) => option.visual) ?? null;

  // Colours still waiting for a hero. The base colour already has the full set.
  const pendingColours =
    visual?.values.filter(
      (value) =>
        value.approved &&
        value.id !== baseHeroValueId &&
        !heroByValueId[value.id] &&
        !generatingValueIds.includes(value.id) &&
        variantReference(value),
    ) ?? [];

  const approvedWithoutReference =
    visual?.values.filter((value) => value.approved && value.id !== baseHeroValueId && !variantReference(value)) ?? [];

  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <h3>Varianter</h3>
          <p>
            Bara godkända val exporteras. Namnet i fältet är det som hamnar i Shopify, leverantörens namn står
            under.
          </p>
        </div>
        <span className="chip chip-muted">
          {variantCount > 0 ? `${variantCount} varianter exporteras` : "Exporteras utan varianter"}
        </span>
      </header>

      <div className="panel-body stack">
        {exportIssues.length > 0 ? (
          <Notice tone="warning" title="Produkten kan inte exporteras än">
            <ul className="notice-list">
              {exportIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </Notice>
        ) : null}

        {options.map((option) => (
          <div className="variant-group" key={option.id}>
            <div className="variant-group-head">
              <div className="variant-group-name">
                <input
                  aria-label="Gruppnamn"
                  className="input"
                  onChange={(event) => onRenameOption(option.id, event.target.value)}
                  placeholder="Gruppnamn"
                  value={option.name}
                />
                <span className="field-source">Leverantör: {option.supplierName}</span>
              </div>
              <label className="approve-toggle approve-toggle-compact">
                <input
                  checked={option.approved}
                  disabled={!option.name.trim()}
                  onChange={() => onToggleOption(option.id)}
                  type="checkbox"
                />
                <span className="approve-box" aria-hidden="true">
                  <Check size={12} />
                </span>
                <span>Godkänn gruppnamn</span>
              </label>
              <button className="button button-ghost" onClick={() => onToggleAll(option.id)} type="button">
                <Check size={15} />
                {option.values.every((value) => value.approved) ? "Avmarkera alla" : "Välj alla"}
              </button>
            </div>

            {option.visual ? (
              <ul className="variant-grid">
                {option.values.map((value) => (
                  <ColourCard
                    failure={failures.find((failure) => failure.valueId === value.id)?.reason ?? ""}
                    hasHero={Boolean(heroByValueId[value.id])}
                    isBase={value.id === baseHeroValueId}
                    isGenerating={generatingValueIds.includes(value.id)}
                    isMain={value.id === mainValueId}
                    key={value.id}
                    onRename={(name) => onRenameValue(option.id, value.id, name)}
                    onSetMain={() => onSetMain(value.id)}
                    onSetReference={(reference) => onSetReference(option.id, value.id, reference)}
                    onToggle={() => onToggleValue(option.id, value.id)}
                    optionId={option.id}
                    value={value}
                  />
                ))}
              </ul>
            ) : (
              <ul className="variant-list">
                {option.values.map((value) => (
                  <li className={`variant-row${value.approved ? " is-approved" : ""}`} key={value.id}>
                    <label className="approve-toggle approve-toggle-compact">
                      <input
                        checked={value.approved}
                        disabled={!value.name.trim()}
                        onChange={() => onToggleValue(option.id, value.id)}
                        type="checkbox"
                      />
                      <span className="approve-box" aria-hidden="true">
                        <Check size={12} />
                      </span>
                      <span className="visually-hidden">Inkludera {value.name}</span>
                    </label>
                    <input
                      aria-label="Namn"
                      className="input"
                      onChange={(event) => onRenameValue(option.id, value.id, event.target.value)}
                      value={value.name}
                    />
                    <span className="field-source">{value.supplierName}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

        {visual ? (
          <div className="variant-generate">
            <button
              className="button button-secondary"
              disabled={!hasMainHero || pendingColours.length === 0}
              onClick={() => onGenerateColours(pendingColours.map((value) => value.id))}
              type="button"
            >
              {generatingValueIds.length > 0 ? <Loader2 className="spin" size={15} /> : <Images size={15} />}
              {pendingColours.length > 0
                ? `Generera bilder för ${pendingColours.length} ${pendingColours.length === 1 ? "färg" : "färger"}`
                : "Generera färgbilder"}
            </button>
            <p className="ai-toolbar-hint">
              {!hasMainHero
                ? "Generera huvudfärgens bilder först. Varje annan färg får en huvudbild som matchar den."
                : `En bild per godkänd färg, ett bildanrop vardera. Färgen hämtas från färgens egen bild, inte från namnet.`}
            </p>
            {approvedWithoutReference.length > 0 ? (
              <p className="image-warning">
                Saknar referensbild och genereras inte:{" "}
                {approvedWithoutReference.map((value) => value.name || value.supplierName).join(", ")}. Lägg till en
                egen bild på färgen.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

type ColourCardProps = {
  failure: string;
  hasHero: boolean;
  isBase: boolean;
  isGenerating: boolean;
  isMain: boolean;
  onRename: (name: string) => void;
  onSetMain: () => void;
  onSetReference: (reference: ReferenceFile | null) => void;
  onToggle: () => void;
  optionId: string;
  value: ReviewVariantValue;
};

function ColourCard({
  failure,
  hasHero,
  isBase,
  isGenerating,
  isMain,
  onRename,
  onSetMain,
  onSetReference,
  onToggle,
  optionId,
  value,
}: ColourCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const applyFile = async (file: File | undefined) => {
    if (file && isReferenceImageFile(file)) {
      onSetReference({ dataUrl: await readFileAsDataUrl(file), name: file.name });
    }
  };

  const handlePaste = async (event: ClipboardEvent<HTMLLIElement>) => {
    const file = Array.from(event.clipboardData.files)[0];
    if (file) {
      event.preventDefault();
      await applyFile(file);
    }
  };

  const handleSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    await applyFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const preview = value.customReference?.dataUrl || value.thumbnailUrl;

  const status = isGenerating
    ? "Genererar bild…"
    : failure
      ? `Misslyckades: ${failure}`
      : isBase
        ? "Har hela bildsetet"
        : hasHero
          ? "Bild genererad"
          : !variantReference(value)
            ? "Saknar referensbild"
            : "";

  return (
    <li className={`variant-card${value.approved ? " is-selected" : ""}`} onPaste={handlePaste} tabIndex={-1}>
      <div className="variant-swatch">
        {preview ? (
          <img alt={value.name} loading="lazy" src={preview} />
        ) : value.hexColor ? (
          <span className="variant-hex" style={{ background: value.hexColor }} title={value.hexColor} />
        ) : (
          <ImageOff size={18} />
        )}
        {isMain ? (
          <span className="variant-main-badge" title="Huvudfärg">
            <Star size={11} />
          </span>
        ) : null}
      </div>

      <input
        aria-label="Färgnamn"
        className="input variant-name"
        onChange={(event) => onRename(event.target.value)}
        value={value.name}
      />
      <span className="field-source" title={value.supplierName}>
        Leverantör: {value.supplierName}
      </span>

      <div className="variant-card-actions">
        <label className="approve-toggle approve-toggle-compact">
          <input checked={value.approved} disabled={!value.name.trim()} onChange={onToggle} type="checkbox" />
          <span className="approve-box" aria-hidden="true">
            <Check size={12} />
          </span>
          <span>Inkludera</span>
        </label>
        <label className="variant-radio">
          <input checked={isMain} name={`main-${optionId}`} onChange={onSetMain} type="radio" />
          <span>Huvudfärg</span>
        </label>
      </div>

      <div className="variant-reference">
        {value.customReference ? (
          <>
            <span>Egen referens</span>
            <button
              aria-label="Ta bort egen referens"
              className="icon-button"
              onClick={() => onSetReference(null)}
              type="button"
            >
              <X size={13} />
            </button>
          </>
        ) : (
          <button className="link-button" onClick={() => inputRef.current?.click()} type="button">
            <ImagePlus size={12} /> {value.imageUrl ? "Byt referens" : "Lägg till referens"}
          </button>
        )}
        <input
          accept="image/png,image/jpeg,image/webp"
          className="visually-hidden"
          onChange={handleSelect}
          ref={inputRef}
          type="file"
        />
      </div>

      {status ? (
        <p className={`variant-status${failure || !variantReference(value) ? " is-warning" : ""}`}>{status}</p>
      ) : null}
    </li>
  );
}
