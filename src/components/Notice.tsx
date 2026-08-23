import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import type { ReactNode } from "react";

type NoticeTone = "error" | "info" | "success" | "warning";

const icons: Record<NoticeTone, typeof Info> = {
  error: AlertTriangle,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
};

type NoticeProps = {
  children: ReactNode;
  onDismiss?: () => void;
  title?: string;
  tone: NoticeTone;
};

export function Notice({ children, onDismiss, title, tone }: NoticeProps) {
  const Icon = icons[tone];

  return (
    <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon aria-hidden="true" className="notice-icon" size={17} />
      <div className="notice-body">
        {title ? <p className="notice-title">{title}</p> : null}
        <div className="notice-content">{children}</div>
      </div>
      {onDismiss ? (
        <button aria-label="Stäng" className="notice-dismiss" onClick={onDismiss} type="button">
          <X size={15} />
        </button>
      ) : null}
    </div>
  );
}
