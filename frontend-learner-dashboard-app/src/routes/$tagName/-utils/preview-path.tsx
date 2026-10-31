import { createContext, useContext, type ReactNode } from "react";

/**
 * The real route of the page the editor's Website view is showing ("" = the
 * site's home). The editor previews every page at the site root, so anything
 * that asks "am I on the home page?" must ask this first. Undefined outside
 * the editor preview, where the address bar is the truth.
 */
const PreviewPathContext = createContext<string | undefined>(undefined);

export const PreviewPathProvider = ({ value, children }: { value: string | undefined; children: ReactNode }) => (
  <PreviewPathContext.Provider value={value}>{children}</PreviewPathContext.Provider>
);

export const usePreviewPath = (): string | undefined => useContext(PreviewPathContext);

/** Home for a preview path: the site root or the home page's own route. */
export const isHomePreviewPath = (previewPath: string): boolean =>
  ["", "home", "homepage"].includes(previewPath.replace(/^\/+|\/+$/g, "").toLowerCase());
