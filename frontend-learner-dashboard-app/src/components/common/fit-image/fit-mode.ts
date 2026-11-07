/**
 * Fill or fit? The pure rule behind FitImage.
 *
 * A content image (a card cover, a folder tile) sits in a box whose shape the
 * section decides, while the image keeps whatever shape it was uploaded in.
 * Filling the box (object-cover) cuts the image's overflow off; fitting it
 * (object-contain) shows all of it with the box's spare room left over.
 *
 * Filling is right when it cuts little — a 16:9 cover in a 16:9 card loses
 * nothing, a 4:3 photo in that card loses a band top and bottom. When it
 * would cut more than `maxCrop` of the image (a square logo in a wide card, a
 * tall poster in a landscape tile: text and faces at the edges disappear),
 * the image is fitted instead, over a blurred copy of itself.
 */
export type ImageFit = "auto" | "cover" | "contain";

/** How much of the image filling may cut off before the image is fitted instead. */
export const DEFAULT_MAX_CROP = 0.3;

export interface Size {
  width: number;
  height: number;
}

const usable = (s: Size | null | undefined): s is Size =>
  !!s && s.width > 0 && s.height > 0 && Number.isFinite(s.width) && Number.isFinite(s.height);

/** The share of the image (0..1) that filling the box would cut off. */
export const cropShare = (image: Size, box: Size): number => {
  const ri = image.width / image.height;
  const rb = box.width / box.height;
  return 1 - Math.min(ri, rb) / Math.max(ri, rb);
};

/**
 * "cover" or "contain" for an image in a box. Anything unknown (the image or
 * the box not measured yet) is "cover" — what these sections always did — so
 * an image changes only once it is known to lose too much.
 */
export const resolveFit = (
  fit: ImageFit,
  image: Size | null | undefined,
  box: Size | null | undefined,
  maxCrop: number = DEFAULT_MAX_CROP,
): "cover" | "contain" => {
  if (fit !== "auto") return fit;
  if (!usable(image) || !usable(box)) return "cover";
  return cropShare(image, box) > maxCrop ? "contain" : "cover";
};
