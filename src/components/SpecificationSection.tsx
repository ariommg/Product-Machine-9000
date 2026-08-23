import { Check, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ReviewSpecificationField } from "../review/reviewWorkflow";

type SpecificationSectionProps = {
  focusSpecificationId: string;
  onAdd: () => void;
  onApproveAll: () => void;
  onChange: (specificationId: string, patch: Partial<ReviewSpecificationField>) => void;
  onRemove: (specificationId: string) => void;
  onToggleApproval: (specificationId: string) => void;
  specifications: ReviewSpecificationField[];
};

export function SpecificationSection({
  focusSpecificationId,
  onAdd,
  onApproveAll,
  onChange,
  onRemove,
  onToggleApproval,
  specifications,
}: SpecificationSectionProps) {
  const focusRef = useRef<HTMLInputElement>(null);

  // A row added by the button appears at the top of the list, so put the cursor
  // straight into it rather than making the user hunt for the new empty row.
  useEffect(() => {
    if (focusSpecificationId) {
      focusRef.current?.focus();
    }
  }, [focusSpecificationId]);

  const fillable = specifications.filter(
    (specification) => specification.name.trim() && specification.value.trim(),
  );
  const allApproved = fillable.length > 0 && fillable.every((specification) => specification.approved);
  const approvedCount = specifications.filter((specification) => specification.approved).length;

  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <h3>Specifikationer</h3>
          <p>
            {approvedCount} av {specifications.length} godkända. Endast godkända rader hamnar i beskrivningen.
          </p>
        </div>
        <div className="panel-actions">
          <button className="button button-ghost" disabled={fillable.length === 0} onClick={onApproveAll} type="button">
            <Check size={15} />
            {allApproved ? "Avmarkera alla" : "Godkänn alla"}
          </button>
          <button className="button button-secondary" onClick={onAdd} type="button">
            <Plus size={15} />
            Lägg till specifikation
          </button>
        </div>
      </header>

      <div className="panel-body">
        {specifications.length === 0 ? (
          <p className="empty-hint">Inga specifikationer hittades. Lägg till dem manuellt.</p>
        ) : (
          <ul className="spec-list">
            {specifications.map((specification) => (
              <li className={`spec-row${specification.approved ? " is-approved" : ""}`} key={specification.id}>
                <input
                  aria-label="Namn"
                  className="input spec-name"
                  onChange={(event) => onChange(specification.id, { approved: false, name: event.target.value })}
                  placeholder="Namn"
                  ref={specification.id === focusSpecificationId ? focusRef : undefined}
                  value={specification.name}
                />
                <input
                  aria-label="Värde"
                  className="input spec-value"
                  onChange={(event) => onChange(specification.id, { approved: false, value: event.target.value })}
                  placeholder="Värde"
                  value={specification.value}
                />

                <label className="approve-toggle approve-toggle-compact">
                  <input
                    checked={specification.approved}
                    disabled={!specification.name.trim() || !specification.value.trim()}
                    onChange={() => onToggleApproval(specification.id)}
                    type="checkbox"
                  />
                  <span className="approve-box" aria-hidden="true">
                    <Check size={12} />
                  </span>
                  <span className="visually-hidden">Godkänn {specification.name || "specifikation"}</span>
                </label>

                <button
                  aria-label="Ta bort rad"
                  className="icon-button"
                  onClick={() => onRemove(specification.id)}
                  type="button"
                >
                  <Trash2 size={15} />
                </button>

                <span className="spec-source">{specification.source}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
