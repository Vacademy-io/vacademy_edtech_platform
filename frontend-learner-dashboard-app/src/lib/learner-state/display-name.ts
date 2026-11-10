/**
 * Whether a stored first name can be greeted. Some accounts hold a phone number or an
 * email there, and a very long run of letters would not fit a greeting anyway.
 */
export function looksLikeName(firstName: string | null | undefined): boolean {
  const name = (firstName ?? "").trim();
  if (!name || Array.from(name).length > 20) return false;
  if (/[\p{Nd}@_+=/\\]/u.test(name)) return false;
  return !/\p{L}{2,}\.\p{L}{2,}/u.test(name);
}

/**
 * Whether a renamed term was saved in the plural ("Chapters"), which no "this ..."
 * sentence can use. English-only by nature: that is where such names are typed.
 */
export const termLooksPlural = (term: string): boolean => /[^s]s$/i.test(term.trim());
