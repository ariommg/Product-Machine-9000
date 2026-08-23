import { Images, Loader2, Sparkles } from "lucide-react";
import type { AiImageCount, AiImageModel } from "../types/ai";

const imageModelOptions: Array<{ label: string; value: AiImageModel }> = [
  { label: "GPT Image 1", value: "gpt-image-1" },
  { label: "GPT Image 2", value: "gpt-image-2" },
];

const imageCountOptions: Array<{ label: string; value: AiImageCount }> = [
  { label: "1 bild", value: 1 },
  { label: "2 bilder", value: 2 },
  { label: "3 bilder", value: 3 },
  { label: "4 bilder", value: 4 },
];

type AiToolbarProps = {
  imageCount: AiImageCount;
  imageModel: AiImageModel;
  isGeneratingImages: boolean;
  isGeneratingText: boolean;
  onGenerateImages: () => void;
  onGenerateText: () => void;
  onImageCountChange: (imageCount: AiImageCount) => void;
  onImageModelChange: (imageModel: AiImageModel) => void;
  referenceCount: number;
};

export function AiToolbar({
  imageCount,
  imageModel,
  isGeneratingImages,
  isGeneratingText,
  onGenerateImages,
  onGenerateText,
  onImageCountChange,
  onImageModelChange,
  referenceCount,
}: AiToolbarProps) {
  return (
    <div className="ai-toolbar">
      <div className="ai-toolbar-group">
        <button className="button button-primary" disabled={isGeneratingText} onClick={onGenerateText} type="button">
          {isGeneratingText ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
          {isGeneratingText ? "Genererar text…" : "Generera text"}
        </button>
        <p className="ai-toolbar-hint">Titel, beskrivning och specifikationer på svenska.</p>
      </div>

      <div className="ai-toolbar-divider" />

      <div className="ai-toolbar-group">
        <div className="ai-toolbar-row">
          <button
            className="button button-secondary"
            disabled={isGeneratingImages}
            onClick={onGenerateImages}
            type="button"
          >
            {isGeneratingImages ? <Loader2 className="spin" size={15} /> : <Images size={15} />}
            {isGeneratingImages ? "Genererar bilder…" : "Generera bilder"}
          </button>

          <label className="select-field">
            <span className="visually-hidden">Bildmodell</span>
            <select onChange={(event) => onImageModelChange(event.target.value as AiImageModel)} value={imageModel}>
              {imageModelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="select-field">
            <span className="visually-hidden">Antal bilder</span>
            <select
              onChange={(event) => onImageCountChange(Number(event.target.value) as AiImageCount)}
              value={imageCount}
            >
              {imageCountOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="ai-toolbar-hint">
          {referenceCount > 0
            ? `${referenceCount} referensbild${referenceCount === 1 ? "" : "er"} används.`
            : "Ingen referensbild vald. Bilderna genereras enbart från texten."}
        </p>
      </div>
    </div>
  );
}
