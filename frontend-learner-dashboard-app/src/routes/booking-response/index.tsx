import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { CalendarX } from "@phosphor-icons/react";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { ModernCard } from "@/components/design-system/modern-card";
import { handleGetBookingPage } from "./-services/booking-services";
import BookingPage from "./-components/booking-page";
import { useTranslation } from "react-i18next";

const bookingParamsSchema = z.object({
  instituteId: z.string().min(1),
  slug: z.string().min(1),
  // "1" from the My Mentors flow → book via the authenticated endpoint.
  authed: z.string().optional(),
});

export const Route = createFileRoute("/booking-response/")({
  validateSearch: bookingParamsSchema,
  component: RouteComponent,
  // Malformed/missing search params (zod validation failure) land here — show
  // a friendly message instead of the generic error page.
  errorComponent: () => {
    const { t } = useTranslation("liveClassGuest");
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-neutral-50 px-4">
        <ModernCard variant="glass" padding="lg" rounded="lg" className="max-w-md">
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-neutral-100">
              <CalendarX size={32} className="text-neutral-400" />
            </div>
            <h2 className="text-h3 font-semibold text-neutral-700">
              {t("bookingResponse.errorPage.incompleteTitle")}
            </h2>
            <p className="text-body text-neutral-500">
              {t("bookingResponse.errorPage.incompleteDescription")}
            </p>
          </div>
        </ModernCard>
      </div>
    );
  },
});

function RouteComponent() {
  const { t } = useTranslation("liveClassGuest");
  const { instituteId, slug, authed } = Route.useSearch();

  const {
    data: pageData,
    isLoading,
    isError,
  } = useQuery(handleGetBookingPage({ instituteId, slug }));

  if (isLoading) {
    return <DashboardLoader />;
  }

  if (isError || !pageData) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-neutral-50 px-4">
        <ModernCard variant="glass" padding="lg" rounded="lg" className="max-w-md">
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-neutral-100">
              <CalendarX size={32} className="text-neutral-400" />
            </div>
            <h2 className="text-h3 font-semibold text-neutral-700">
              {t("bookingResponse.errorPage.notFoundTitle")}
            </h2>
            <p className="text-body text-neutral-500">
              {t("bookingResponse.errorPage.notFoundDescription")}
            </p>
          </div>
        </ModernCard>
      </div>
    );
  }

  return (
    <BookingPage
      pageData={pageData}
      instituteId={instituteId}
      slug={slug}
      authed={authed === "1"}
    />
  );
}
