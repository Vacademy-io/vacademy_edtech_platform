/**
 * The CBE kit's strings in the learner's language (questionTest `cbe.kit.*`).
 * Pass the result to <CbeStringsProvider> around any kit component. English
 * defaults cover the moment before the catalog has loaded.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_CBE_STRINGS, type CbeStrings, type CbeToolKey } from "@/components/cbe/cbe-strings";

export function useLearnerCbeStrings(): CbeStrings {
  const { t, i18n } = useTranslation("questionTest");
  const language = i18n.language;
  return useMemo(() => {
    const d = DEFAULT_CBE_STRINGS;
    const k = (key: string, fallback: string, options?: Record<string, unknown>) =>
      t(`cbe.kit.${key}`, { defaultValue: fallback, ...options }) as string;
    const tools = Object.fromEntries(
      (Object.keys(d.tools) as CbeToolKey[]).map((key) => [key, k(`tools.${key}`, d.tools[key])]),
    ) as Record<CbeToolKey, string>;
    return {
      kind: {
        SPREADSHEET: k("kindSpreadsheet", d.kind.SPREADSHEET),
        DOCUMENT: k("kindDocument", d.kind.DOCUMENT),
      },
      marks: (count) => k("marks", d.marks(count), { count }),
      partAnswer: (tabLabel) => k("partAnswer", d.partAnswer(tabLabel), { tab: tabLabel }),
      noParts: k("noParts", d.noParts),
      sizeTooLarge: (size, max) => k("sizeTooLarge", d.sizeTooLarge(size, max), { size, max }),
      sizeNearLimit: (size, max) => k("sizeNearLimit", d.sizeNearLimit(size, max), { size, max }),
      spreadsheetLoadFailed: k("spreadsheetLoadFailed", d.spreadsheetLoadFailed),
      documentLoadFailed: k("documentLoadFailed", d.documentLoadFailed),
      tryAgain: k("tryAgain", d.tryAgain),
      documentPlaceholder: k("documentPlaceholder", d.documentPlaceholder),
      writtenAnswer: k("writtenAnswer", d.writtenAnswer),
      spreadsheetAnswer: k("spreadsheetAnswer", d.spreadsheetAnswer),
      noSpreadsheetAnswer: k("noSpreadsheetAnswer", d.noSpreadsheetAnswer),
      noWrittenAnswer: k("noWrittenAnswer", d.noWrittenAnswer),
      emptyTab: k("emptyTab", d.emptyTab),
      rowHeader: k("rowHeader", d.rowHeader),
      tools,
    };
    // `language` re-runs this when the learner switches language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, language]);
}
