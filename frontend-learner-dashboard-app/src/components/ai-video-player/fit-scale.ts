/**
 * Scale that fits a fixed-size stage inside its container. The default view
 * keeps a small margin so the stage does not touch the edges.
 */
export const fitScale = (
  containerWidth: number,
  containerHeight: number,
  stageWidth: number,
  stageHeight: number,
  isFullscreen: boolean
): number => {
  const scale = Math.min(containerWidth / stageWidth, containerHeight / stageHeight);
  return isFullscreen ? Math.min(scale, 1) : Math.min(scale * 0.98, 1);
};
