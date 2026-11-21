/**
 * The one option of a language select on a single-language paper. The
 * preview carries no paper language yet, so this is the platform's default
 * content language (English), named in the learner's UI language.
 */
export const DEFAULT_PAPER_LANGUAGE = "en";

export function singleLanguageOption(uiLanguage: string | undefined): {
  code: string;
  label: string;
} {
  let label = "English";
  try {
    label =
      new Intl.DisplayNames([uiLanguage || "en"], { type: "language" }).of(
        DEFAULT_PAPER_LANGUAGE,
      ) ?? label;
  } catch {
    // Older engines without Intl.DisplayNames keep the English name.
  }
  return { code: DEFAULT_PAPER_LANGUAGE, label };
}
