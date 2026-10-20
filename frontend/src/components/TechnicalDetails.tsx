import type { ReactNode } from "react";

export function TechnicalDetails({ children, title = "Chi tiết kỹ thuật" }: { children: ReactNode; title?: string }) {
  return <details className="technical-details"><summary>{title}</summary><div className="technical-details-body">{children}</div></details>;
}
