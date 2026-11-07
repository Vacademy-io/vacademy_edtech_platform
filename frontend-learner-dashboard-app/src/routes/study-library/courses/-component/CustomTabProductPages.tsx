import { useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, Storefront } from "@phosphor-icons/react";
import { getInstituteId } from "@/constants/helper";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { MyButton } from "@/components/design-system/button";
import { EmptyState, LoadingState } from "@/components/design-system/states";
import { PriceWithMrp } from "@/components/common/price-with-mrp";
import { handleGetProductPage } from "@/routes/product-pages/$productPageCode/-services/product-page-service";
import type { ProductPageData } from "@/routes/product-pages/$productPageCode/-types/product-page-types";
import type { StudentAllCoursesCustomTabProductPage } from "@/types/student-display-settings";

/** Cheapest plan across the page's courses, with its MRP. */
const cheapestPlan = (page: ProductPageData | undefined) => {
  const plans = (page?.mappings ?? [])
    .map((m) => m.payment_plan)
    .filter((p): p is NonNullable<typeof p> => p != null && typeof p.actual_price === "number");
  if (plans.length === 0) return null;
  return plans.reduce((min, p) => ((p.actual_price ?? 0) < (min.actual_price ?? 0) ? p : min));
};

const ProductPageCard = ({
  saved,
  page,
  isLoading,
  instituteId,
}: {
  saved: StudentAllCoursesCustomTabProductPage;
  page: ProductPageData | undefined;
  isLoading: boolean;
  instituteId: string;
}) => {
  const { t } = useTranslation("study");
  const navigate = useNavigate();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const imageId = page?.mappings?.find((m) => m.course_preview_image_media_id)?.course_preview_image_media_id;
  const plan = cheapestPlan(page);

  useEffect(() => {
    let cancelled = false;
    setImageUrl(null);
    if (!imageId) return;
    getPublicUrlWithoutLogin(imageId)
      .then((url) => {
        if (!cancelled && url) setImageUrl(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [imageId]);

  const open = () =>
    navigate({
      to: "/product-pages/$productPageCode",
      params: { productPageCode: saved.code },
      search: { instituteId } as never,
    });

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      <button type="button" onClick={open} className="aspect-video w-full bg-muted">
        {imageUrl ? (
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-muted-foreground">
            <Storefront size={40} weight="duotone" />
          </span>
        )}
      </button>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <h3 className="line-clamp-2 text-subtitle font-semibold text-foreground">
          {page?.name || saved.name}
        </h3>
        {page?.mappings && page.mappings.length > 1 && (
          <p className="text-caption text-muted-foreground">
            {t("catalog.customTab.coursesCount", { count: page.mappings.length })}
          </p>
        )}
        <div className="mt-auto flex items-end justify-between gap-2">
          {isLoading ? (
            <span className="h-5 w-16 animate-pulse rounded bg-muted" />
          ) : plan ? (
            <PriceWithMrp
              actual={plan.actual_price}
              elevated={plan.elevated_price}
              currency={page?.currency}
              size="sm"
            />
          ) : (
            <span />
          )}
          <MyButton buttonType="primary" scale="medium" layoutVariant="default" onClick={open}>
            {t("catalog.customTab.open")}
            <ArrowRight size={16} className="ms-1.5" />
          </MyButton>
        </div>
      </div>
    </div>
  );
};

/** Courses-page custom tab of type PRODUCT_PAGES: one card per chosen page. */
export const CustomTabProductPages = ({ pages }: { pages: StudentAllCoursesCustomTabProductPage[] }) => {
  const { t } = useTranslation("study");
  const [instituteId, setInstituteId] = useState<string | null>(null);

  useEffect(() => {
    getInstituteId().then((id) => setInstituteId(id ?? ""));
  }, []);

  const queries = useQueries({
    queries: pages.map((p) => ({
      ...handleGetProductPage(p.code, instituteId ?? ""),
      enabled: !!instituteId,
      staleTime: 5 * 60 * 1000,
      retry: 1,
    })),
  });

  if (instituteId === null) return <LoadingState variant="cards" count={Math.min(pages.length, 3)} />;

  // A deleted or unpublished page fails by-code; leave it out instead of
  // showing a dead card.
  const shown = pages
    .map((saved, i) => ({ saved, query: queries[i] }))
    .filter(({ query }) => !query?.isError);

  if (shown.length === 0) {
    return <EmptyState icon={Storefront} title={t("catalog.customTab.productPagesEmpty")} />;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {shown.map(({ saved, query }) => (
        <ProductPageCard
          key={saved.code}
          saved={saved}
          page={query?.data as ProductPageData | undefined}
          isLoading={!!query?.isLoading}
          instituteId={instituteId}
        />
      ))}
    </div>
  );
};
