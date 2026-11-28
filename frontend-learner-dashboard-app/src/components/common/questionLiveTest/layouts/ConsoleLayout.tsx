import { ProctorLayer } from "@/components/common/proctoring/ProctorLayer";
import { useLiveTestStore } from "@/stores/live-test-store";
import { topSafeAreaInset } from "@/utils/safe-area";
import NetworkStatus from "../network-status";
import { useLiveTestEngine } from "../engine/live-test-engine-context";
import { useLiveTestUi } from "../live-test-ui-context";
import { InstructionsModal } from "../widgets/InstructionsModal";
import { QuestionPaperModal } from "../widgets/QuestionPaperModal";
import { ConsoleProvider } from "./console-context";
import { consoleScreenFor } from "./index";

/**
 * Console exam layout (TCS family). Draws the screen of the theme's layout
 * variant, desktop or phone, inside the theme root that styles/exam-themes/
 * tcs.css keys on. The engine (clocks, autosave, submit, proctoring) is
 * mounted above this and is the same as for the default layout.
 */
export function ConsoleLayout() {
  const { examTheme, isCompact } = useLiveTestUi();
  const { assessmentId, retrySave } = useLiveTestEngine();
  const immersiveActive = useLiveTestStore((s) => s.immersiveActive);
  const Screen = consoleScreenFor(examTheme.layout.variant, isCompact);
  return (
    <ConsoleProvider>
      <div
        data-exam-theme={examTheme.id}
        data-exam-theme-family={examTheme.family}
        data-exam-layout={examTheme.layout.variant}
        className={isCompact ? "tcs-root tcs-root--phone" : "tcs-root"}
        style={{ // design-lint-ignore: dynamic safe-area inset padding
          paddingTop: topSafeAreaInset(immersiveActive),
        }}
      >
        {/* Renders nothing unless the assessment is proctored. */}
        {assessmentId && <ProctorLayer assessmentId={assessmentId} />}
        <NetworkStatus onRetrySave={retrySave} />
        <Screen />
        <QuestionPaperModal />
        <InstructionsModal />
      </div>
    </ConsoleProvider>
  );
}
