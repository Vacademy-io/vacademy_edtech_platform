/** Read-only, sanitized rendering of a written (DOCUMENT) answer. */
import { useMemo } from "react";
import { sanitizeRichHtml } from "@/lib/sanitize-html";
import { cn } from "@/lib/utils";
import { useCbeStrings } from "./cbe-strings";
import { htmlToPlainText } from "./types";
import "./cbe-doc.css";

export type DocumentViewProps = {
  html: string | null | undefined;
  className?: string;
  /** Shown when the answer has no visible text. */
  emptyText?: string;
};

export function DocumentView({ html, className, emptyText: emptyTextProp }: DocumentViewProps) {
  const fallbackEmpty = useCbeStrings().noWrittenAnswer;
  const emptyText = emptyTextProp ?? fallbackEmpty;
  // The admin app's shared rich-text sanitiser (drops form controls, fixed positioning, scripts).
  const clean = useMemo(() => sanitizeRichHtml(html), [html]);
  if (!htmlToPlainText(clean) && !/<table/i.test(clean)) {
    return <p className={cn("text-body italic text-muted-foreground", className)}>{emptyText}</p>;
  }
  return (
    <div
      className={cn("cbe-doc text-body", className)}
      data-cbe-document-view=""
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

export default DocumentView;
