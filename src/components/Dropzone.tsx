import { FileUp, Loader2 } from "lucide-react";
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { htmlFilesFromDrop } from "../lib/fileImport";

type DropzoneProps = {
  isImporting: boolean;
  onFiles: (files: File[]) => void;
  variant: "full" | "compact";
};

export function Dropzone({ isImporting, onFiles, variant }: DropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    onFiles(await htmlFilesFromDrop(event.dataTransfer));
  };

  const handleSelect = (event: ChangeEvent<HTMLInputElement>) => {
    onFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  return (
    <div
      className={`dropzone dropzone-${variant}${isDragging ? " is-dragging" : ""}`}
      onDragLeave={() => setIsDragging(false)}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDrop={handleDrop}
    >
      <input
        accept=".html,.htm,text/html"
        className="visually-hidden"
        multiple
        onChange={handleSelect}
        ref={inputRef}
        type="file"
      />

      {variant === "full" ? (
        <>
          <div className="dropzone-icon">
            {isImporting ? <Loader2 className="spin" size={24} /> : <FileUp size={24} />}
          </div>
          <h2>Släpp sparade produktsidor här</h2>
          <p>
            Spara produktsidan i webbläsaren med <kbd>Ctrl</kbd> + <kbd>S</kbd> och släpp .html-filerna här.
            Flera filer eller en hel mapp åt gången fungerar.
          </p>
          <button className="button button-primary" onClick={() => inputRef.current?.click()} type="button">
            Välj filer
          </button>
        </>
      ) : (
        <button className="button button-ghost dropzone-compact-button" onClick={() => inputRef.current?.click()} type="button">
          {isImporting ? <Loader2 className="spin" size={15} /> : <FileUp size={15} />}
          Lägg till fler filer
        </button>
      )}
    </div>
  );
}
