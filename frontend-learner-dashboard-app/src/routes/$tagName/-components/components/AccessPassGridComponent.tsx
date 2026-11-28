import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { FitImage } from "@/components/common/fit-image/FitImage";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";
import {
  buildPassCheckoutUrl,
  formatPublicPassPrice,
  getPublicAccessPassBySlug,
  listPublicAccessPasses,
  type PublicAccessPass,
  type PublicAccessPassItem,
} from "../../-services/access-pass-service";
import type { GlobalSettings } from "../../-types/course-catalogue-types";

/**
 * Catalogue section `accessPassGrid`: published Access Passes as cards. A card opens
 * the pass's details (included courses, price) in a dialog, deep-linkable through
 * `?pass=<slug>` like the folder browser's `?folder=`. Buying goes to the existing
 * enroll-by-invite checkout with the pass's invite code, so payment, coupons and
 * custom fields work exactly as on any invite.
 */

const PASS_PARAM = "pass";

const COLUMN_CLASSES: Record<number, string> = {
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
};

interface AccessPassGridProps {
  title?: string;
  subtitle?: string;
  tag?: string;
  columns?: number;
  buyLabel?: string;
  showCourses?: boolean;
  showPrice?: boolean;
  backgroundColor?: string;
  instituteId?: string;
  tagName?: string;
  isPreviewMode?: boolean;
  globalSettings?: GlobalSettings;
}

const courseLabel = (item: PublicAccessPassItem) =>
  [item.package_name, item.level_name, item.session_name]
    .filter(Boolean)
    .join(" · ");

export const AccessPassGridComponent: React.FC<AccessPassGridProps> = ({
  title,
  subtitle,
  tag,
  columns = 3,
  buyLabel,
  showCourses = true,
  showPrice = true,
  backgroundColor,
  instituteId,
  isPreviewMode,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const location = useLocation();
  const router = useRouter();
  const hidePurchase = shouldHidePaidPurchaseUI();
  const cols = Math.min(Math.max(Number(columns) || 3, 2), 4);

  const { data: passes = [], isLoading } = useQuery({
    queryKey: ["ACCESS_PASS_PUBLIC_LIST", instituteId, tag ?? ""],
    queryFn: () => listPublicAccessPasses(instituteId!, tag),
    enabled: !!instituteId,
    staleTime: 60_000,
  });

  const openSlug = useMemo(
    () => new URLSearchParams(location.searchStr || "").get(PASS_PARAM),
    [location.searchStr],
  );
  const { data: openPass, isLoading: detailLoading } = useQuery({
    queryKey: ["ACCESS_PASS_PUBLIC_DETAIL", instituteId, openSlug],
    queryFn: () => getPublicAccessPassBySlug(instituteId!, openSlug!),
    enabled: !!instituteId && !!openSlug,
    staleTime: 60_000,
    retry: (count, err: unknown) =>
      (err as { response?: { status?: number } })?.response?.status !== 510 &&
      count < 2,
  });

  const setOpen = (slug: string | null) => {
    const params = new URLSearchParams(location.searchStr || "");
    if (slug) params.set(PASS_PARAM, slug);
    else params.delete(PASS_PARAM);
    const qs = params.toString();
    router.history.push(`${location.pathname}${qs ? `?${qs}` : ""}`);
  };

  const buy = (pass: PublicAccessPass) => {
    if (!instituteId || !pass.invite_code || isPreviewMode) return;
    window.location.assign(buildPassCheckoutUrl(instituteId, pass.invite_code));
  };

  const ctaLabel = buyLabel || t("accessPass.buy", "Get the pass");
  const priceOf = (pass: PublicAccessPass) =>
    showPrice ? formatPublicPassPrice(pass.price, t("accessPass.free", "Free")) : null;

  if (!instituteId) return null;
  if (!isLoading && passes.length === 0) {
    // Visitors never see an empty section; the builder preview explains it.
    return isPreviewMode ? (
      <section className="catalogue-section bg-catalogue-bg">
        <div className="catalogue-shell">
          <div className="catalogue-card border-dashed p-8 text-center text-sm text-catalogue-text-muted">
            {t(
              "accessPass.emptyPreview",
              "No published access passes yet. This section stays hidden until one is published.",
            )}
          </div>
        </div>
      </section>
    ) : null;
  }

  return (
    <section
      className="catalogue-section bg-catalogue-bg"
      style={backgroundColor ? { backgroundColor } : undefined}
    >
      <div className="catalogue-shell">
        {(title || subtitle) && (
          <div className="catalogue-section-header">
            {title && <h2 className="catalogue-h2">{title}</h2>}
            {subtitle && (
              <p className="catalogue-lead catalogue-measure-start">{subtitle}</p>
            )}
          </div>
        )}

        <div
          className={cn(
            "grid gap-4 md:gap-6",
            "grid-cols-1 sm:grid-cols-2",
            COLUMN_CLASSES[cols],
          )}
        >
          {isLoading
            ? Array.from({ length: cols }).map((_, i) => (
                <div key={i} className="catalogue-card overflow-hidden">
                  <div className="catalogue-skeleton catalogue-aspect-video w-full" />
                  <div className="p-4">
                    <div className="catalogue-skeleton catalogue-skeleton-title w-2/3" />
                  </div>
                </div>
              ))
            : passes.map((pass) => {
                const price = priceOf(pass);
                return (
                  <button
                    key={pass.id}
                    type="button"
                    onClick={() => setOpen(pass.slug)}
                    className="catalogue-card-elevated group flex h-full w-full flex-col overflow-hidden text-start"
                  >
                    <div className="catalogue-aspect-video relative w-full overflow-hidden bg-catalogue-bg-muted">
                      {pass.cover_image_url ? (
                        <FitImage
                          src={pass.cover_image_url}
                          alt=""
                          loading="lazy"
                          className="absolute inset-0 size-full"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-3xl text-catalogue-text-muted">
                          🎟️
                        </div>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-2 p-4">
                      <h3 className="text-lg font-semibold text-catalogue-text-primary">
                        {pass.name}
                      </h3>
                      {pass.short_description && (
                        <p className="text-sm text-catalogue-text-muted">
                          {pass.short_description}
                        </p>
                      )}
                      <p className="text-sm text-catalogue-text-muted">
                        {t("accessPass.courseCount", {
                          defaultValue: "{{count}} courses included",
                          count: pass.course_count ?? 0,
                        })}
                      </p>
                      <div className="mt-auto flex items-center justify-between pt-2">
                        {price ? (
                          <span className="text-base font-semibold text-catalogue-brand-ink">
                            {price}
                          </span>
                        ) : (
                          <span />
                        )}
                        <span className="text-sm font-medium text-catalogue-brand-ink group-hover:underline">
                          {t("accessPass.viewDetails", "View details")}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
        </div>
      </div>

      <Dialog open={!!openSlug} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          {detailLoading || !openPass ? (
            <div className="p-6 text-sm text-catalogue-text-muted">
              {detailLoading
                ? t("accessPass.loading", "Loading…")
                : t("accessPass.notFound", "This pass is no longer available.")}
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{openPass.name}</DialogTitle>
                {openPass.short_description && (
                  <DialogDescription>{openPass.short_description}</DialogDescription>
                )}
              </DialogHeader>
              {openPass.cover_image_url && (
                <div className="catalogue-aspect-video relative w-full overflow-hidden rounded-md bg-catalogue-bg-muted">
                  <FitImage
                    src={openPass.cover_image_url}
                    alt=""
                    className="absolute inset-0 size-full"
                  />
                </div>
              )}
              {openPass.description && (
                <p className="whitespace-pre-line text-sm text-catalogue-text-primary">
                  {openPass.description}
                </p>
              )}
              {showCourses && (openPass.items ?? []).length > 0 && (
                <div className="flex flex-col gap-2">
                  <h4 className="font-semibold">
                    {t("accessPass.whatsIncluded", "What's included")}
                  </h4>
                  <ul className="divide-y rounded-md border">
                    {openPass.items!.map((item) => (
                      <li key={item.package_session_id} className="px-3 py-2 text-sm">
                        {courseLabel(item)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col">
                  {priceOf(openPass) && (
                    <span className="text-lg font-semibold">{priceOf(openPass)}</span>
                  )}
                  {openPass.price?.min_validity_in_days && (
                    <span className="text-xs text-catalogue-text-muted">
                      {t("accessPass.validity", {
                        defaultValue: "Access for {{days}} days",
                        days: openPass.price.min_validity_in_days,
                      })}
                    </span>
                  )}
                </div>
                {!hidePurchase && openPass.invite_code && (
                  <button
                    type="button"
                    className="catalogue-btn catalogue-btn-primary"
                    disabled={isPreviewMode}
                    onClick={() => buy(openPass)}
                  >
                    {ctaLabel}
                  </button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default AccessPassGridComponent;
