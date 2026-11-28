import type { ImageRef } from "@/types/learner-home";

/** "url 320w, url 640w, …" from the WebP renditions, smallest first. Empty when there are none. */
export function srcSetOf(image: ImageRef | null | undefined): string {
  const renditions = image?.renditions;
  if (!renditions) return "";
  return Object.entries(renditions)
    .map(([w, url]) => [Number(w), url] as const)
    .filter(([w, url]) => Number.isFinite(w) && w > 0 && typeof url === "string" && url)
    .sort((a, b) => a[0] - b[0])
    .map(([w, url]) => `${url} ${w}w`)
    .join(", ");
}

/** The alt text: empty for a decorative image, else the admin's text. */
export const altOf = (image: ImageRef | null | undefined): string =>
  !image || image.decorative ? "" : (image.alt ?? "").trim();
