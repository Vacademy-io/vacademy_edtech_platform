import { createFileRoute, type ErrorComponentProps } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import AssessmentRegistrationForm from "./-component/AssessmentRegistrationForm";
import AssessmentClosedExpiredComponent from "./-component/AssessmentClosedExpiredComponent";
import { utmSearchSchema } from "@/lib/utm-search-params";
import { resolveRegisterErrorScreen } from "./-utils/request-error";
import { reloadForChunkError } from "@/lib/chunk-reload";
import { OPEN_REGISTRATION_DETAILS_QUERY_KEY } from "./-services/open-registration-services";

const registerParamsSchema = z.object({
  code: z.union([z.string(), z.number()]),
  // Declared so the router does not strip them off the URL — see utmSearchSchema.
  ...utmSearchSchema,
});

/**
 * Everything thrown while rendering this route lands here: the suspense
 * lookup failing (bad share code, backend down, offline) as well as a plain
 * render bug. Each gets its own screen — none of them may claim the
 * assessment has expired, because at this point we don't know its state.
 */
const RegisterErrorComponent = ({ error, reset }: ErrorComponentProps) => {
  const { t } = useTranslation("registrationA");
  const queryClient = useQueryClient();
  const screen = resolveRegisterErrorScreen(error);

  // `screen` is rebuilt every render, so depend on its discriminant instead of
  // the object or this logs on every re-render.
  const screenKind = screen.kind;
  useEffect(() => {
    console.error("[register] failed to load:", screenKind, error);
  }, [error, screenKind]);

  // A stale tab cannot be fixed by re-running the query — the module the route
  // needs is gone from the CDN. Reload instead, exactly as the router's default
  // error page does everywhere else. `reloadForChunkError` is budgeted, so if
  // the reload does not help we fall through to the normal error screen rather
  // than looping.
  const [reloading, setReloading] = useState(screenKind === "reload");
  useEffect(() => {
    if (screenKind !== "reload") return;
    if (!reloadForChunkError(error)) setReloading(false);
  }, [screenKind, error]);

  const retry = () => {
    // Drop the failed query so the remounted form fetches fresh instead of
    // re-throwing the cached error.
    queryClient.removeQueries({ queryKey: [OPEN_REGISTRATION_DETAILS_QUERY_KEY] });
    reset();
  };

  if (screenKind === "reload" && reloading) {
    return (
      <div className="flex h-screen w-screen select-none items-center justify-center bg-gray-50 px-4 text-gray-700">
        <p className="text-lg font-semibold">{t("loadError.updating")}</p>
      </div>
    );
  }

  if (screenKind === "notFound") {
    return <AssessmentClosedExpiredComponent variant="notFound" />;
  }

  if (screenKind === "expired") {
    return <AssessmentClosedExpiredComponent variant="expired" />;
  }

  return (
    <AssessmentClosedExpiredComponent
      variant={screenKind === "network" ? "network" : "error"}
      detail={screen.kind === "error" ? screen.detail : undefined}
      onRetry={retry}
    />
  );
};

export const Route = createFileRoute("/register/")({
  validateSearch: registerParamsSchema,
  component: RouteComponent,
  errorComponent: RegisterErrorComponent,
});

function RouteComponent() {
  return <AssessmentRegistrationForm />;
}
