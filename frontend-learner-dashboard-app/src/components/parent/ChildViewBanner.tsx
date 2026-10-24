import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, SignOut } from "@phosphor-icons/react";
import { FullScreenLoader } from "@/components/common/FullScreenLoader";
import {
  isChildViewActive,
  getChildViewName,
  exitChildView,
} from "@/routes/parent/child/-lib/child-view";

/**
 * The persistent "you are viewing as your child" banner, shown app-wide while a
 * guardian is in child-view. Exiting restores the parent's own session. Rendered
 * from the app root; renders nothing when child-view is inactive.
 */
export function ChildViewBanner() {
  const { t } = useTranslation("parent");
  const [exiting, setExiting] = useState(false);
  const active = isChildViewActive();

  // The banner is fixed (h-10), so push the whole app down while it is shown —
  // otherwise it covers the learner top bar (which sticks below it, see navbar).
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.paddingTop;
    document.body.style.paddingTop = "2.5rem"; // = h-10, genuinely dynamic (banner active)
    return () => {
      document.body.style.paddingTop = prev;
    };
  }, [active]);

  if (!active) return null;
  const name = getChildViewName();

  // Restoring the parent session + hard reload takes a few seconds — cover it.
  if (exiting)
    return <FullScreenLoader label={t("childView.exiting")} />;

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex h-10 items-center justify-center gap-3 bg-primary-500 px-4 text-primary-50 shadow-md">
      <Eye weight="fill" className="size-4 shrink-0" aria-hidden />
      <span className="text-caption font-medium">
        {t("childView.banner", { name: name || t("common.yourChild") })}
      </span>
      <button
        onClick={async () => {
          setExiting(true);
          await exitChildView();
        }}
        disabled={exiting}
        className="ms-1 inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-caption font-semibold transition-opacity disabled:opacity-60"
      >
        <SignOut className="size-3.5" aria-hidden />
        {t("childView.exit")}
      </button>
    </div>
  );
}
