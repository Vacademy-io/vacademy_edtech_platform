import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GridFour } from "@phosphor-icons/react";
import { useLiveTestStore } from "@/stores/live-test-store";
import { bottomSafeAreaInset } from "@/utils/safe-area";
import { useLiveTestEngine } from "../engine/live-test-engine-context";
import { BottomActionBar } from "../widgets/BottomActionBar";
import { ConsoleClock } from "../widgets/ConsoleClock";
import { PhonePaletteSheet } from "../widgets/PhonePaletteSheet";
import { QuestionPane } from "../widgets/QuestionPane";
import { QuestionTypeRow } from "../widgets/QuestionTypeRow";
import { SectionTabStrip } from "../widgets/SectionTabStrip";
import { useConsole } from "./console-context";

/**
 * Phone variant of the TCS console (<768px): a top bar with the title and
 * Time Left, horizontally scrolling section tabs, the question, and a fixed
 * bottom bar with the same three actions. The legend, palette and Submit
 * open in a bottom sheet from the "Question Palette" button. The actions
 * follow the same rules as on desktop.
 */
export function TcsPhoneScreen() {
  const { t } = useTranslation("questionTest");
  const { assessmentName } = useLiveTestEngine();
  const immersiveActive = useLiveTestStore((s) => s.immersiveActive);
  const { chrome } = useConsole();
  const [isSheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <header className="tcs-phone-top">
        <span className="tcs-phone-top__title">{assessmentName}</span>
        <ConsoleClock />
      </header>
      <SectionTabStrip compact />
      {chrome.questionTypeRow && <QuestionTypeRow />}
      <QuestionPane
        trailing={
          <button
            type="button"
            className="tcs-phone-palette-button"
            onClick={() => setSheetOpen(true)}
          >
            <GridFour size={16} weight="fill" aria-hidden="true" />
            {t("examThemes.tcs.questionPalette")}
          </button>
        }
      />
      <div
        className="tcs-phone-bottom"
        style={{ // design-lint-ignore: dynamic safe-area inset padding
          paddingBottom: bottomSafeAreaInset(immersiveActive),
        }}
      >
        <BottomActionBar />
      </div>
      <PhonePaletteSheet open={isSheetOpen} onOpenChange={setSheetOpen} />
    </>
  );
}
