/**
 * The part of a live streamed reply the learner should see. The model may end
 * its reply with a machine trailer line such as `%%suggest:[...]`; the server
 * strips it from the saved message, but the raw tokens still carry it. Hide
 * everything from the first `%%`, and a lone trailing `%` (which may be the
 * start of one), so the trailer never flickers on screen.
 */
export const visibleStreamText = (raw: string): string => {
  const trailer = raw.indexOf("%%");
  let text = trailer === -1 ? raw : raw.slice(0, trailer);
  if (trailer === -1 && text.endsWith("%")) text = text.slice(0, -1);
  return text.trimEnd();
};
