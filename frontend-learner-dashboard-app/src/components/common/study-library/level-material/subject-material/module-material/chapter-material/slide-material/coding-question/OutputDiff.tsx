import { useTranslation } from "react-i18next";

interface Props {
  actual: string;
  expected: string;
  // When the test case accepts more than one valid output, the diff is shown
  // against the primary (acceptedOutputs[0]); this drives an explanatory banner
  // so a learner isn't confused that a non-primary-but-valid-looking output
  // "failed" — it failed because it matched none of the accepted answers.
  acceptedCount?: number;
}

function firstDiffIndex(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

/**
 * Line-level diff between a learner's stdout and the expected stdout. Lines
 * that differ are highlighted red; trailing lines present on only one side
 * show as inserted/missing. A trailing note points at the first differing
 * character so long near-match outputs (whitespace, off-by-one digit) are
 * easy to spot without squinting.
 */
export function OutputDiff({ actual, expected, acceptedCount }: Props) {
  const { t } = useTranslation("libraryCommonA");
  const a = actual.replace(/\r\n/g, "\n");
  const e = expected.replace(/\r\n/g, "\n");
  const aLines = a.split("\n");
  const eLines = e.split("\n");
  const maxLen = Math.max(aLines.length, eLines.length);

  const rows: Array<{ a?: string; e?: string; diff: boolean }> = [];
  for (let i = 0; i < maxLen; i++) {
    const av = aLines[i];
    const ev = eLines[i];
    rows.push({ a: av, e: ev, diff: av !== ev });
  }

  const idx = firstDiffIndex(a, e);
  const firstDiffMsg =
    idx < 0
      ? null
      : idx >= a.length
        ? t("codingQuestion.outputDiff.expectedMoreChars", { count: e.length - a.length, position: a.length })
        : idx >= e.length
          ? t("codingQuestion.outputDiff.extraChars", { count: a.length - e.length, position: e.length })
          : t("codingQuestion.outputDiff.firstMismatch", { index: idx, got: JSON.stringify(a[idx]), expected: JSON.stringify(e[idx]) });

  return (
    <div className="space-y-1">
      {(acceptedCount ?? 1) > 1 && (
        <div className="text-2xs text-gray-500">
          {t("codingQuestion.outputDiff.acceptsMultiple", { count: acceptedCount })}
        </div>
      )}
      <div className="grid grid-cols-[auto,1fr,1fr] gap-x-2 rounded border bg-white p-1 font-mono text-2xs">
        <div className="col-span-1" />
        <div className="text-3xs font-semibold uppercase text-gray-500">
          {t("codingQuestion.outputDiff.yourOutput")}
        </div>
        <div className="text-3xs font-semibold uppercase text-gray-500">
          {t("codingQuestion.outputDiff.expected")}
        </div>
        {rows.map((r, i) => (
          <Row key={i} idx={i + 1} a={r.a} e={r.e} diff={r.diff} />
        ))}
      </div>
      {firstDiffMsg && (
        <div className="text-2xs text-red-700">{firstDiffMsg}</div>
      )}
    </div>
  );
}

function Row({
  idx,
  a,
  e,
  diff,
}: {
  idx: number;
  a?: string;
  e?: string;
  diff: boolean;
}) {
  const { t } = useTranslation("libraryCommonA");
  const bg = diff ? "bg-red-50" : "";
  return (
    <>
      <div className={`px-1 text-end text-gray-400 ${bg}`}>{idx}</div>
      <div className={`whitespace-pre break-all px-1 ${bg}`}>
        {a === undefined ? (
          <span className="text-gray-400">—</span>
        ) : a === "" ? (
          <span className="text-gray-400">{t("codingQuestion.outputDiff.empty")}</span>
        ) : (
          a
        )}
      </div>
      <div className={`whitespace-pre break-all px-1 ${bg}`}>
        {e === undefined ? (
          <span className="text-gray-400">—</span>
        ) : e === "" ? (
          <span className="text-gray-400">{t("codingQuestion.outputDiff.empty")}</span>
        ) : (
          e
        )}
      </div>
    </>
  );
}
