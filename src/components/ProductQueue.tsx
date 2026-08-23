import { ImageOff, Trash2 } from "lucide-react";
import { requiredFieldsApproved } from "../review/reviewWorkflow";
import type { SessionProduct } from "../hooks/useSession";

type ProductQueueProps = {
  activeProductId: string;
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
  products: SessionProduct[];
};

const previewImage = (product: SessionProduct) => {
  const generated = product.reviewState.images.find((image) => image.kind === "ai-generated" && image.approved);
  return generated?.url ?? product.reviewState.images[0]?.url ?? "";
};

export function ProductQueue({ activeProductId, onRemove, onSelect, products }: ProductQueueProps) {
  return (
    <ul className="queue">
      {products.map((product, index) => {
        const isReady = requiredFieldsApproved(product.reviewState);
        const title = product.reviewState.fields[0]?.value || product.fileName;
        const thumbnail = previewImage(product);

        return (
          <li key={product.id}>
            <div className={`queue-item${product.id === activeProductId ? " is-active" : ""}`}>
              <button className="queue-select" onClick={() => onSelect(product.id)} type="button">
                <span className="queue-thumb">
                  {thumbnail ? <img alt="" loading="lazy" src={thumbnail} /> : <ImageOff size={15} />}
                </span>
                <span className="queue-text">
                  <span className="queue-index">Produkt {index + 1}</span>
                  <span className="queue-title">{title}</span>
                  <span className={`queue-state${isReady ? " is-ready" : ""}`}>
                    {isReady ? "Klar för export" : "Behöver granskas"}
                  </span>
                </span>
              </button>
              <button
                aria-label={`Ta bort ${title}`}
                className="queue-remove"
                onClick={() => onRemove(product.id)}
                type="button"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
