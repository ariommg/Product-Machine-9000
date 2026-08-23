import { Download, Loader2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Dropzone } from "./components/Dropzone";
import { Notice } from "./components/Notice";
import { ProductQueue } from "./components/ProductQueue";
import { ReviewPanel } from "./components/ReviewPanel";
import { useSession } from "./hooks/useSession";
import { useSessionExit } from "./hooks/useSessionExit";
import { fetchImageConfig, requestHostedImageDeletion } from "./lib/api";
import { buildCsvFilename, buildShopifyCsv, downloadCsvFile } from "./lib/shopifyCsv";
import type { AiImageCount, AiImageModel } from "./types/ai";

export default function App() {
  const {
    actions,
    activeProduct,
    exportableDrafts,
    hostedImageHistory,
    importError,
    isImporting,
    products,
  } = useSession();

  const [imageModel, setImageModel] = useState<AiImageModel>("gpt-image-1");
  const [imageCount, setImageCount] = useState<AiImageCount>(4);
  const [hostingConfigured, setHostingConfigured] = useState(true);
  const [exportedSignature, setExportedSignature] = useState("");
  const [cleanupState, setCleanupState] = useState<"idle" | "running" | "done">("idle");
  const [cleanupError, setCleanupError] = useState("");

  useEffect(() => {
    let isMounted = true;
    void fetchImageConfig().then((config) => {
      if (isMounted && config) {
        setImageModel(config.imageModel);
        setHostingConfigured(config.hostingConfigured);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // Changes after an export make the session dirty again, so the close warning
  // comes back rather than staying dismissed for the rest of the session.
  const sessionSignature = useMemo(
    () => JSON.stringify({ count: products.length, drafts: exportableDrafts }),
    [exportableDrafts, products.length],
  );

  const hasUnexportedWork = products.length > 0 && sessionSignature !== exportedSignature;

  useSessionExit({ hostedImageUrls: hostedImageHistory, warnOnClose: hasUnexportedWork });

  const handleExport = () => {
    if (exportableDrafts.length === 0) {
      return;
    }
    downloadCsvFile(buildShopifyCsv(exportableDrafts), buildCsvFilename(exportableDrafts.length));
    setExportedSignature(sessionSignature);
    setCleanupState("idle");
    setCleanupError("");
  };

  const handleCleanup = async () => {
    setCleanupState("running");
    setCleanupError("");
    try {
      await requestHostedImageDeletion(hostedImageHistory);
      setCleanupState("done");
    } catch (error) {
      setCleanupState("idle");
      setCleanupError(error instanceof Error ? error.message : "Rensningen misslyckades.");
    }
  };

  const hasExported = Boolean(exportedSignature);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">PM</span>
          <div>
            <h1>Product Machine 9000</h1>
            <p>Sparade produktsidor in, Shopify-CSV ut. Inget sparas mellan sessioner.</p>
          </div>
        </div>

        <div className="header-actions">
          {products.length > 0 ? (
            <span className="export-count">
              <strong>{exportableDrafts.length}</strong> av {products.length} klara
            </span>
          ) : null}
          <button
            className="button button-primary"
            disabled={exportableDrafts.length === 0}
            onClick={handleExport}
            type="button"
          >
            <Download size={15} />
            Exportera CSV
          </button>
        </div>
      </header>

      <main className="app-main">
        {products.length === 0 ? (
          <div className="empty-state">
            <Dropzone isImporting={isImporting} onFiles={(files) => void actions.importFiles(files)} variant="full" />
            {importError ? <Notice tone="error">{importError}</Notice> : null}
            {!hostingConfigured ? (
              <Notice tone="warning" title="Bildhosting är inte konfigurerad">
                BLOB_READ_WRITE_TOKEN saknas. Du kan generera bilder och förhandsgranska dem, men de kan inte
                exporteras till Shopify förrän token är satt.
              </Notice>
            ) : null}
          </div>
        ) : (
          <div className="workspace">
            <aside className="sidebar">
              <div className="sidebar-head">
                <h2>Session</h2>
                <button className="link-button" onClick={actions.clearSession} type="button">
                  Rensa
                </button>
              </div>

              <ProductQueue
                activeProductId={activeProduct?.id ?? ""}
                onRemove={actions.removeProduct}
                onSelect={actions.setActiveProductId}
                products={products}
              />

              <Dropzone
                isImporting={isImporting}
                onFiles={(files) => void actions.importFiles(files)}
                variant="compact"
              />

              {importError ? <Notice tone="error">{importError}</Notice> : null}
            </aside>

            <div className="content">
              {hasExported ? (
                <Notice tone="success" title="CSV nedladdad">
                  <p>
                    Importera filen i Shopify och kontrollera att bilderna syns. Rensa sedan de tillfälligt hostade
                    bilderna.
                  </p>
                  {hostedImageHistory.length > 0 ? (
                    <div className="cleanup-row">
                      <button
                        className="button button-ghost"
                        disabled={cleanupState !== "idle"}
                        onClick={() => void handleCleanup()}
                        type="button"
                      >
                        {cleanupState === "running" ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} />}
                        {cleanupState === "done"
                          ? "Bilderna är rensade"
                          : `Rensa ${hostedImageHistory.length} hostade bilder`}
                      </button>
                      <span className="cleanup-hint">Rensas automatiskt när du stänger fliken.</span>
                    </div>
                  ) : null}
                  {cleanupError ? <p className="cleanup-error">{cleanupError}</p> : null}
                </Notice>
              ) : null}

              {activeProduct ? (
                <ReviewPanel
                  actions={actions}
                  imageCount={imageCount}
                  imageModel={imageModel}
                  key={activeProduct.id}
                  onImageCountChange={setImageCount}
                  onImageModelChange={setImageModel}
                  product={activeProduct}
                />
              ) : null}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
