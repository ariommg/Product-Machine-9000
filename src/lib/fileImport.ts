export const isHtmlFile = (file: File) => /\.html?$/i.test(file.name) || file.type === "text/html";

export const isReferenceImageFile = (file: File) =>
  /^image\/(png|jpe?g|webp)$/i.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);

export const readFileAsText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error(`Kunde inte läsa ${file.name}.`));
    reader.readAsText(file);
  });

export const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error(`Kunde inte läsa ${file.name}.`));
    reader.readAsDataURL(file);
  });

type DroppedFileEntry = {
  file: (onSuccess: (file: File) => void, onError?: () => void) => void;
  isDirectory: false;
  isFile: true;
  name: string;
};

type DroppedDirectoryEntry = {
  createReader: () => {
    readEntries: (onSuccess: (entries: DroppedEntry[]) => void, onError?: () => void) => void;
  };
  isDirectory: true;
  isFile: false;
  name: string;
};

type DroppedEntry = DroppedFileEntry | DroppedDirectoryEntry;

const readDroppedFile = (entry: DroppedFileEntry) =>
  new Promise<File | null>((resolve) => {
    entry.file(resolve, () => resolve(null));
  });

/** readEntries only returns a page at a time, so it has to be drained in a loop. */
const readDirectoryEntries = (entry: DroppedDirectoryEntry) =>
  new Promise<DroppedEntry[]>((resolve) => {
    const reader = entry.createReader();
    const collected: DroppedEntry[] = [];

    const readNextBatch = () => {
      reader.readEntries((entries) => {
        if (entries.length === 0) {
          resolve(collected);
          return;
        }
        collected.push(...entries);
        readNextBatch();
      }, () => resolve(collected));
    };

    readNextBatch();
  });

const collectHtmlFiles = async (entry: DroppedEntry): Promise<File[]> => {
  if (entry.isFile) {
    const file = await readDroppedFile(entry);
    return file && isHtmlFile(file) ? [file] : [];
  }

  const entries = await readDirectoryEntries(entry);
  const nested = await Promise.all(entries.map(collectHtmlFiles));
  return nested.flat();
};

/** Accepts individual files and dropped folders, so a whole batch can land at once. */
export const htmlFilesFromDrop = async (dataTransfer: DataTransfer): Promise<File[]> => {
  // The DOM's FileSystemEntry type does not describe the callback-based reader
  // this API actually exposes, so the narrower local shapes are used instead.
  const entries = Array.from(dataTransfer.items)
    .map((item) => item.webkitGetAsEntry() as DroppedEntry | null)
    .filter((entry): entry is DroppedEntry => entry !== null);

  if (entries.length > 0) {
    const files = await Promise.all(entries.map(collectHtmlFiles));
    return files.flat();
  }

  return Array.from(dataTransfer.files).filter(isHtmlFile);
};
