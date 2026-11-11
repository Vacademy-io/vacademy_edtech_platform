import { useTranslation } from "react-i18next";
import { Question } from "@phosphor-icons/react";
import { useDoubtManagementSetting } from "@/services/doubt-management-settings";
import { useMyQueries } from "@/services/my-queries";
import { useQueryDialogStore } from "@/stores/useQueryDialogStore";
import { ChevronIcon } from "./fun-icons";

/**
 * The "Raise a query" card on the Fun home, as a Fun row. Same gate, words and action
 * as the classic RaiseQueryCard: shown only when the institute turned the dashboard
 * card on, it opens the shared query dialog (on "My queries" when cases are open).
 */
export function FunQueryRow() {
  const { t } = useTranslation("dashboard");
  const { showDashboardCard } = useDoubtManagementSetting();
  const open = useQueryDialogStore((s) => s.open);
  const { openCount, isError } = useMyQueries(showDashboardCard);
  if (!showDashboardCard) return null;
  const hasOpen = !isError && openCount > 0;

  return (
    <button type="button" className="fun-row fun-row--query" onClick={() => open(hasOpen ? "my-queries" : "raise")}>
      <span className="fun-row__icon fun-row__icon--query" aria-hidden="true">
        <Question weight="bold" />
      </span>
      <span className="fun-row__words">
        <span className="fun-row__title">{t("raiseQuery.title")}</span>
        <span className="fun-row__sub">{hasOpen ? t("raiseQuery.openQueries", { count: openCount }) : t("raiseQuery.subtitle")}</span>
      </span>
      {hasOpen ? <span className="fun-row__count">{openCount}</span> : null}
      <ChevronIcon className="fun-row__chevron" />
    </button>
  );
}
