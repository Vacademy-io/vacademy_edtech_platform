import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
// import { useEffect } from "react";
// import { useNavigate } from "@tanstack/react-router";
// import { z } from "zod";

export const Route = createFileRoute("/live-class-guest/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation("liveClassGuest");
//   const navigate = useNavigate();

//   useEffect(() => {
//     navigate({
//       to: "/live-class-guest/waiting-room",
//       search: { sessionId, guestId },
//     });
//   }, [sessionId, guestId]);

  return <div>{t("guestHome.placeholder")}</div>;
}
