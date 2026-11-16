/**
 * Attachment handling for the institute-authored instruction text, shared by
 * the default brief (AssessmentInstructions) and the themed templates.
 */
export interface InstructionAttachment {
  url: string;
  fileName: string;
  isPdf: boolean;
}

const FILE_EXT_PATTERN =
  /\.(pdf|docx?|xlsx?|csv|pptx?|zip|rar|7z|tar|gz|jpg|jpeg|png|gif|svg|webp|mp4|mov|webm|mp3|wav|ogg)(\?|#|$)/i;

/**
 * The instruction rich-text can embed a question paper as a file-attachment
 * anchor (`<a data-attachment="true" href="…pdf">`). Rendered raw it shows up
 * as a bare link, so we pull those anchors out of the HTML, strip them so they
 * don't render twice, and surface PDFs as an inline viewer / other files as
 * download links. Mirrors `extractAndStripAttachments` in assignment-slide.tsx.
 */
export const parseInstructions = (
  html: string,
  fallbackAttachmentName: string
): { cleanHtml: string; attachments: InstructionAttachment[] } => {
  if (!html || typeof DOMParser === "undefined") {
    return { cleanHtml: html, attachments: [] };
  }
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const anchors = doc.querySelectorAll('a[data-attachment="true"], a[href]');
    const attachments: InstructionAttachment[] = [];
    const seen = new Set<string>();

    anchors.forEach((node) => {
      const anchor = node as HTMLAnchorElement;
      const href = anchor.getAttribute("href") || "";
      if (!href || href === "#") return;
      const name =
        anchor.getAttribute("name") || anchor.textContent?.trim() || "";
      const type = anchor.getAttribute("type") || "";
      const isAttachment = anchor.getAttribute("data-attachment") === "true";
      const isFileLink =
        FILE_EXT_PATTERN.test(href) || (!!name && FILE_EXT_PATTERN.test(name));
      if (!isAttachment && !isFileLink) return;

      if (!seen.has(href)) {
        seen.add(href);
        const isPdf =
          /\.pdf(\?|#|$)/i.test(href) ||
          /\.pdf$/i.test(name) ||
          type.toLowerCase().includes("pdf");
        attachments.push({
          url: href,
          fileName: name || href.split("/").pop() || fallbackAttachmentName,
          isPdf,
        });
      }
      anchor.parentNode?.removeChild(anchor);
    });

    return { cleanHtml: doc.body?.innerHTML || "", attachments };
  } catch {
    return { cleanHtml: html, attachments: [] };
  }
};
