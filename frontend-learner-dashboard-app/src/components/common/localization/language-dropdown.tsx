import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useLanguageStore } from "@/stores/localization/useLanguageStore";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../../ui/dropdown-menu";
import { CaretUp, CaretDown, Check, Globe } from "@phosphor-icons/react";
import { useSyncLanguage } from "@/hooks/useSyncLanguage";
import { LOCALE_LABELS } from "@/i18n/locales";
import {
  getEnabledLocales,
  syncLanguageSettingFromSettingJson,
} from "@/services/language-settings";
import { handleGetPublicInstituteDetails } from "@/components/common/layout-container/services/navbar-services";
import { cn } from "@/lib/utils";

interface LanguageDropdownProps {
  /**
   * Wrapper positioning. Defaults to the login-page placement (top-right
   * overlay); pass e.g. 'relative' when rendering inline.
   */
  className?: string;
}

export const LanguageDropdown = ({
  className = "absolute end-4 top-4 z-10",
}: LanguageDropdownProps) => {
  const { t } = useTranslation("layoutCommonB");
  useSyncLanguage();

  const locale = useLanguageStore((state) => state.locale);
  const setLocale = useLanguageStore((state) => state.setLocale);
  const [isOpen, setIsOpen] = useState(false);

  // The cached LANGUAGE_SETTING is only written at login, so refresh it from
  // the public institute details (shared query with the navbar — no extra
  // request) so an admin enabling a language shows up without a re-login,
  // and the pre-login page gets the institute's list at all.
  const { data: instituteDetails } = useQuery({
    ...handleGetPublicInstituteDetails(),
    retry: false,
  });
  useEffect(() => {
    if (instituteDetails?.setting !== undefined) {
      syncLanguageSettingFromSettingJson(instituteDetails.setting);
    }
  }, [instituteDetails]);

  // Institute-enabled locales (always includes the current selection).
  // Recomputed once the details land, since getEnabledLocales reads the cache.
  const enabledLocales = useMemo(
    () => getEnabledLocales(locale),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, instituteDetails]
  );

  const handleChangeLanguage = (nextLocale: string) => {
    setLocale(nextLocale);
    setIsOpen(false);
  };

  return (
    <div className={className}>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger
          className="flex items-center gap-1.5 rounded-md border border-neutral-300 bg-neutral-50 px-2.5 py-1 text-sm text-neutral-600 outline-none hover:bg-neutral-100"
          aria-label={t("languageDropdown.changeLanguage")}
        >
          <Globe className="size-4 shrink-0" />
          <span className="max-w-28 truncate">{LOCALE_LABELS[locale]}</span>
          {isOpen ? <CaretUp className="size-3" /> : <CaretDown className="size-3" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="max-h-72 w-44 overflow-y-auto border border-neutral-300 bg-neutral-50 p-0 text-neutral-600 outline-none"
        >
          {enabledLocales.map((option) => (
            <DropdownMenuItem
              key={option}
              className={cn(
                "flex items-center justify-between px-3 hover:cursor-pointer",
                "focus:bg-primary-100 focus:text-neutral-600"
              )}
              onClick={() => handleChangeLanguage(option)}
            >
              <span lang={option}>{LOCALE_LABELS[option]}</span>
              {locale === option && <Check className="text-primary-400" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
