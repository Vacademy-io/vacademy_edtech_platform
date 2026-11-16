import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Helmet } from "react-helmet";
import { useMediaQuery } from "@/hooks/use-media-query";
import { usePlayTheme } from "@/hooks/use-play-theme";
import { useCleanerPlayTheme } from "@/hooks/use-cleaner-play-theme";
import { useFunTheme } from "@/hooks/use-fun-theme";
import {
  PREVIEW_HOME_EVENT,
  isStudentPreviewMode,
  readStudentPreviewDraft,
} from "@/lib/student-preview";
import { normaliseHome } from "@/services/learner-home";
import { isBuilderHome } from "@/types/learner-home";
import { LearnerHomeRenderer } from "@/routes/dashboard/-components/home-builder/LearnerHomeRenderer";
import { BuiltinPlaceholder } from "@/routes/dashboard/-components/home-builder/blocks/BuiltinBlock";
import { VIEWPORT_ZOOMABLE } from "@/routes/dashboard/-components/home-builder/phone-layout";
import type { LinkContext } from "@/routes/dashboard/-components/home-builder/link-target";

export const Route = createFileRoute("/home-preview/")({
  component: HomePreviewPage,
});

const NO_FOLLOW = {
  navigate: () => {},
  openExternal: () => {},
  assign: () => {},
  openDoubts: () => {},
  openLiveClass: () => {},
  removePreference: () => {},
  setSessionItem: () => {},
};

/**
 * The admin's live preview of a draft learner home (Admin → Learner home).
 *
 * It exists only inside the admin's named preview frame: the draft arrives by
 * postMessage from an allowed admin origin (lib/student-preview) and lives in
 * that frame's sessionStorage. Anywhere else this page sends the visitor to
 * /dashboard. It reads no learner data: built-in widgets are labelled
 * placeholders, links do not navigate, and nothing is sent (analytics,
 * dismiss, acknowledge).
 */
function HomePreviewPage() {
  const { t } = useTranslation("learnerHome");
  const navigate = useNavigate();
  const inFrame = isStudentPreviewMode();
  const [version, setVersion] = useState(0);
  const isLg = useMediaQuery("(min-width: 1024px)");
  const isPhone = useMediaQuery("(max-width: 767px)");
  const play = usePlayTheme();
  const cleanerPlay = useCleanerPlayTheme();
  const fun = useFunTheme();

  useEffect(() => {
    if (!inFrame) navigate({ to: "/dashboard", replace: true });
  }, [inFrame, navigate]);

  // A new draft from the admin redraws without a reload.
  useEffect(() => {
    const onHome = () => setVersion((v) => v + 1);
    window.addEventListener(PREVIEW_HOME_EVENT, onHome);
    return () => window.removeEventListener(PREVIEW_HOME_EVENT, onHome);
  }, []);

  const home = useMemo(
    () => (inFrame ? normaliseHome(readStudentPreviewDraft()?.home) : null),
    // `version` re-reads the stored draft after a "home" message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inFrame, version]
  );
  const skin = useMemo(() => ({ fun, play, cleanerPlay }), [fun, play, cleanerPlay]);
  // The admin cannot evaluate per-learner conditions: every feature counts as on.
  const linkContext: LinkContext = useMemo(() => ({ readerMode: false, playSkin: play }), [play]);

  if (!inFrame) return null;

  return (
    <div className={`min-h-screen w-full bg-background${fun ? " fun-home" : ""}`}>
      <Helmet>
        <meta name="viewport" content={VIEWPORT_ZOOMABLE} />
      </Helmet>
      <div className={`mx-auto w-full max-w-7xl px-4 py-3 sm:p-4 lg:p-6${fun ? " fun-home__inner" : ""}`}>
        {isBuilderHome(home) ? (
          <LearnerHomeRenderer
            home={home}
            header={
              <div className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                {t("preview.header")}
              </div>
            }
            renderBuiltin={(widget) => <BuiltinPlaceholder widget={widget} />}
            isLg={isLg}
            isPhone={isPhone}
            skin={skin}
            linkContext={linkContext}
            followDeps={NO_FOLLOW}
            preview
          />
        ) : (
          <p className="py-16 text-center text-sm text-muted-foreground">{t("preview.waiting")}</p>
        )}
      </div>
    </div>
  );
}
