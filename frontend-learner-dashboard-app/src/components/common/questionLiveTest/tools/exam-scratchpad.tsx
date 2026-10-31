import { PencilSimple } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { ToolPanel } from "./tool-panel";

interface ExamScratchpadProps {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
}

/**
 * Rough-work pad. Its contents live only in the exam shell's React state — they
 * are never included in the save/submit payload, which is exactly what the
 * placeholder promises the learner.
 */
export function ExamScratchpad({
  value,
  onChange,
  onClose,
}: ExamScratchpadProps) {
  const { t } = useTranslation("questionTest");
  return (
    <ToolPanel
      title={t("common.tools.scratchpad")}
      icon={<PencilSimple size={15} weight="duotone" />}
      onClose={onClose}
      className="w-full max-w-reg-320"
    >
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("scratchpad.placeholder")}
        aria-label={t("scratchpad.ariaLabel")}
        className="h-reg-150 w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50 p-3 font-mono text-caption text-neutral-800 outline-none focus:border-primary-300"
      />
    </ToolPanel>
  );
}
