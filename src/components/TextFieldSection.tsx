import { Check } from "lucide-react";
import type { ReviewTextField, ReviewTextFieldKey } from "../review/reviewWorkflow";

type TextFieldSectionProps = {
  fields: ReviewTextField[];
  onApproveAll: () => void;
  onChange: (key: ReviewTextFieldKey, value: string) => void;
  onToggleApproval: (key: ReviewTextFieldKey) => void;
};

export function TextFieldSection({ fields, onApproveAll, onChange, onToggleApproval }: TextFieldSectionProps) {
  const allApproved = fields.every((field) => field.approved);

  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <h3>Produkttext</h3>
          <p>Båda fälten måste godkännas innan produkten kan exporteras.</p>
        </div>
        <button className="button button-ghost" disabled={allApproved} onClick={onApproveAll} type="button">
          <Check size={15} />
          Godkänn båda
        </button>
      </header>

      <div className="panel-body stack">
        {fields.map((field) => (
          <article className={`field-card${field.approved ? " is-approved" : ""}`} key={field.key}>
            <div className="field-head">
              <div>
                <label htmlFor={`field-${field.key}`}>{field.label}</label>
                <span className="field-source">{field.source}</span>
              </div>
              <span className={`chip chip-${field.approved ? "approved" : field.status}`}>
                {field.approved ? "Godkänd" : field.status === "missing" ? "Saknas" : "Ej godkänd"}
              </span>
            </div>

            <textarea
              className="input"
              id={`field-${field.key}`}
              onChange={(event) => onChange(field.key, event.target.value)}
              rows={field.key === "description" ? 7 : 2}
              value={field.value}
            />

            <label className="approve-toggle">
              <input
                checked={field.approved}
                disabled={!field.value.trim()}
                onChange={() => onToggleApproval(field.key)}
                type="checkbox"
              />
              <span className="approve-box" aria-hidden="true">
                <Check size={12} />
              </span>
              <span>Godkänn {field.label.toLowerCase()}</span>
            </label>
          </article>
        ))}
      </div>
    </section>
  );
}
