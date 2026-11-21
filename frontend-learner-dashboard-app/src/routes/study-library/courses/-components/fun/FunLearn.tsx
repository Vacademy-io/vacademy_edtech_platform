import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { FunButton } from "@/components/design-system/fun/FunButton";
import { getTerminology, getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { TokenKey } from "@/constants/auth/tokens";
import { handleGetPublicInstituteDetails } from "@/components/common/layout-container/services/navbar-services";
import { handleFetchUserRoleDetails } from "../../-services/institute-details";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/*
 * The Fun skin's Learn page header: title, count, search and sort
 * (styles/fun/course.css, "Learn list"). The catalogue page keeps its tabs,
 * requests, paging and filters; under ui-fun it draws these. The rows and the
 * list states are in FunLearnList.tsx.
 */

const courseTerms = () => ({
  course: getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase(),
  courses: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase(),
});

/**
 * Page title (the institute's plural course term) and the count of the tab on
 * screen, once its request has answered. Keeps the "create" shortcut a learner
 * who also teaches had in the old header; it reads the same two queries, so no
 * extra request is made.
 */
export function FunLearnHeader({ count }: { count: number | null }) {
  const { t } = useTranslation("funCourse");
  const { t: tStudy } = useTranslation("study");
  const title = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);
  const { data: instituteDetails } = useQuery(handleGetPublicInstituteDetails());
  const { data: roleDetails } = useQuery(handleFetchUserRoleDetails());
  const roleNames: string[] = (roleDetails?.roles ?? []).map((role: { role_name: string }) => role.role_name);
  const teachesToo = roleNames.includes("STUDENT") && roleNames.includes("TEACHER");
  const openTeacherPortal = () => {
    if (!instituteDetails?.teacher_portal_base_url) return;
    const accessToken = localStorage.getItem(TokenKey.accessToken);
    const refreshToken = localStorage.getItem(TokenKey.refreshToken);
    window.location.href = `https://${instituteDetails.teacher_portal_base_url}/auth-transfer?accessToken=${accessToken}&refreshToken=${refreshToken}`;
  };
  return (
    <header className="fun-learn-head">
      <h1 className="fun-learn-head__title">{title}</h1>
      {count !== null ? <p className="fun-learn-head__count">{t("learn.count", { count, ...courseTerms() })}</p> : null}
      {teachesToo ? (
        <FunButton variant="outline" compact className="fun-learn-head__create" onClick={openTeacherPortal}>
          {tStudy("hero.createCourse", { course: getTerminology(ContentTerms.Course, SystemTerms.Course) })}
        </FunButton>
      ) : null}
    </header>
  );
}

/** Search on every tab. Commits on Enter and on leaving the field, as before. */
export function FunLearnSearch({
  value,
  onCommit,
  trailing,
}: {
  value: string;
  onCommit: (value: string) => void;
  /** Beside the field: the sort control, which applies to every tab. */
  trailing?: ReactNode;
}) {
  const { t } = useTranslation("funCourse");
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="fun-learn-search">
      <label htmlFor="fun-learn-search" className="fun-learn-search__label">
        {t("learn.searchLabel", courseTerms())}
      </label>
      <div className="fun-learn-search__field">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.5 15.5 L20 20" />
        </svg>
        <input
          id="fun-learn-search"
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onCommit(draft);
          }}
          onBlur={() => onCommit(draft)}
        />
        {trailing}
      </div>
    </div>
  );
}

/** Sort, shared by every tab: the catalogue's own control, restyled. */
export function FunLearnSort({ sortOption, onSortChange }: { sortOption: string; onSortChange: (value: string) => void }) {
  const { t } = useTranslation("study");
  const { courses } = courseTerms();
  return (
    <div className="fun-learn-tools__sort">
        <Select value={sortOption} onValueChange={onSortChange}>
          <SelectTrigger aria-label={t("catalog.sort.ariaLabel", { courses })} className="fun-learn-tools__trigger">
            <SelectValue placeholder={t("catalog.sort.placeholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Newest">{t("catalog.sort.newest")}</SelectItem>
            <SelectItem value="Oldest">{t("catalog.sort.oldest")}</SelectItem>
            <SelectItem value="HighestRated">{t("catalog.sort.highestRated")}</SelectItem>
            <SelectItem value="Shortest">{t("catalog.sort.shortest")}</SelectItem>
          </SelectContent>
        </Select>
    </div>
  );
}
