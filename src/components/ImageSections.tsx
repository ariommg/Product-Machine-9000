import { Check, ExternalLink, ImageOff, ImagePlus, Trash2 } from "lucide-react";
import { useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from "react";
import { isReferenceImageFile, readFileAsDataUrl } from "../lib/fileImport";
import { isPublicShopifyImageUrl } from "../lib/shopifyCsv";
import type { UserReferenceImage } from "../hooks/useSession";
import type { ReviewImageField } from "../review/reviewWorkflow";

type NewReferenceImage = { dataUrl: string; name: string; origin: UserReferenceImage["origin"] };

type SourceImageSectionProps = {
  images: ReviewImageField[];
  onToggle: (url: string) => void;
  selectedUrls: string[];
};

export function SourceImageSection({ images, onToggle, selectedUrls }: SourceImageSectionProps) {
  if (images.length === 0) {
    return null;
  }

  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <h3>Källbilder</h3>
          <p>Används bara som referens åt bildgenereringen. De exporteras aldrig till Shopify.</p>
        </div>
        <span className="chip chip-muted">{selectedUrls.length} valda</span>
      </header>

      <div className="panel-body">
        <ul className="image-grid">
          {images.map((image) => {
            const isSelected = selectedUrls.includes(image.url);
            return (
              <li className={`image-card${isSelected ? " is-selected" : ""}`} key={image.url}>
                <div className="image-frame">
                  <img alt={image.label} loading="lazy" src={image.url} />
                </div>
                <div className="image-meta">
                  <span className="image-label">{image.label}</span>
                  <a className="image-link" href={image.url} rel="noreferrer" target="_blank">
                    Öppna <ExternalLink size={12} />
                  </a>
                </div>
                <label className="approve-toggle">
                  <input checked={isSelected} onChange={() => onToggle(image.url)} type="checkbox" />
                  <span className="approve-box" aria-hidden="true">
                    <Check size={12} />
                  </span>
                  <span>Använd som referens</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

type ReferenceImageSectionProps = {
  images: UserReferenceImage[];
  maxImages: number;
  onAdd: (images: NewReferenceImage[]) => void;
  onRemove: (referenceId: string) => void;
  onToggle: (referenceId: string) => void;
  selectedIds: string[];
};

export function ReferenceImageSection({
  images,
  maxImages,
  onAdd,
  onRemove,
  onToggle,
  selectedIds,
}: ReferenceImageSectionProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = async (files: File[], origin: UserReferenceImage["origin"]) => {
    const imageFiles = files.filter(isReferenceImageFile).slice(0, maxImages);
    if (imageFiles.length === 0) {
      return;
    }

    const added = await Promise.all(
      imageFiles.map(async (file) => ({ dataUrl: await readFileAsDataUrl(file), name: file.name, origin })),
    );
    onAdd(added);
  };

  const handlePaste = async (event: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length > 0) {
      event.preventDefault();
      await addFiles(files, "Inklistrad");
    }
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    await addFiles(Array.from(event.dataTransfer.files), "Släppt");
  };

  const handleSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    await addFiles(Array.from(event.target.files ?? []), "Uppladdad");
    event.target.value = "";
  };

  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <h3>Egna referensbilder</h3>
          <p>Klistra in, släpp eller ladda upp bilder som bildgenereringen ska utgå från.</p>
        </div>
        <span className="chip chip-muted">{selectedIds.length} valda</span>
      </header>

      <div className="panel-body stack">
        <div
          className={`reference-drop${isDragging ? " is-dragging" : ""}`}
          onDragLeave={() => setIsDragging(false)}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDrop={handleDrop}
          onPaste={handlePaste}
          tabIndex={0}
        >
          <ImagePlus size={18} />
          <p>
            Klistra in med <kbd>Ctrl</kbd> + <kbd>V</kbd>, släpp filer här, eller{" "}
            <button className="link-button" onClick={() => inputRef.current?.click()} type="button">
              välj bilder
            </button>
            .
          </p>
          <input
            accept="image/png,image/jpeg,image/webp"
            className="visually-hidden"
            multiple
            onChange={handleSelect}
            ref={inputRef}
            type="file"
          />
        </div>

        {images.length > 0 ? (
          <ul className="image-grid">
            {images.map((image) => {
              const isSelected = selectedIds.includes(image.id);
              return (
                <li className={`image-card${isSelected ? " is-selected" : ""}`} key={image.id}>
                  <div className="image-frame">
                    <img alt={image.name} src={image.dataUrl} />
                  </div>
                  <div className="image-meta">
                    <span className="image-label" title={image.name}>
                      {image.origin}
                    </span>
                    <button
                      aria-label={`Ta bort ${image.name}`}
                      className="icon-button"
                      onClick={() => onRemove(image.id)}
                      type="button"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <label className="approve-toggle">
                    <input checked={isSelected} onChange={() => onToggle(image.id)} type="checkbox" />
                    <span className="approve-box" aria-hidden="true">
                      <Check size={12} />
                    </span>
                    <span>Använd som referens</span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

type GeneratedImageSectionProps = {
  images: ReviewImageField[];
  onToggle: (url: string) => void;
  onToggleAll: () => void;
};

export function GeneratedImageSection({ images, onToggle, onToggleAll }: GeneratedImageSectionProps) {
  const exportable = images.filter((image) => isPublicShopifyImageUrl(image.url));
  const approvedCount = images.filter((image) => image.approved).length;

  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <h3>Genererade bilder</h3>
          <p>Bara dessa kan exporteras till Shopify, och bara när de har en publik adress.</p>
        </div>
        {exportable.length > 0 ? (
          <button className="button button-ghost" onClick={onToggleAll} type="button">
            <Check size={15} />
            {approvedCount === exportable.length ? "Avmarkera alla" : "Välj alla"}
          </button>
        ) : null}
      </header>

      <div className="panel-body">
        {images.length === 0 ? (
          <p className="empty-hint">
            <ImageOff size={15} /> Inga bilder genererade än. Utan bilder exporteras produkten utan bildkolumner.
          </p>
        ) : (
          <ul className="image-grid">
            {images.map((image) => {
              const canExport = isPublicShopifyImageUrl(image.url);
              return (
                <li className={`image-card${image.approved ? " is-selected" : ""}`} key={image.url}>
                  <div className="image-frame">
                    <img alt={image.label} src={image.url} />
                  </div>
                  <div className="image-meta">
                    <span className="image-label">{image.label}</span>
                    <a className="image-link" download href={image.url} rel="noreferrer" target="_blank">
                      Öppna <ExternalLink size={12} />
                    </a>
                  </div>

                  {canExport ? (
                    <label className="approve-toggle">
                      <input checked={image.approved} onChange={() => onToggle(image.url)} type="checkbox" />
                      <span className="approve-box" aria-hidden="true">
                        <Check size={12} />
                      </span>
                      <span>Inkludera i export</span>
                    </label>
                  ) : (
                    <p className="image-warning">{image.hostingError ?? "Bilden saknar publik adress och kan inte exporteras."}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
