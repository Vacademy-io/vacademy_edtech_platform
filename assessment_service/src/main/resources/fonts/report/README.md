Fonts for the student AI report PDF (AiReportHtmlBuilderV2), loaded by AiReportFonts.

- Mukta Regular / Bold — body text. Mukta SemiBold is deliberately absent: iText 7.2.5's
  GPOS parser throws on it (GposLookupType1 IndexOutOfBounds).
- Baloo 2 SemiBold / Bold / ExtraBold — headings and numbers. Google ships Baloo 2 only as a
  variable font, which iText cannot use; these are static instances made with
  `fonttools varLib.instancer` and renamed to family "Baloo 2" so CSS font-weight selects them.

- Noto Sans Math Regular — symbols the two families lack (Greek letters, arrows, ∴ ∠ △ and
  other maths). AiReportHtmlBuilderV2.esc wraps only those characters in this font, so a
  line never switches face mid-sentence.

All three families are SIL Open Font License 1.1 (see OFL-*.txt) and cover Latin and Devanagari.
