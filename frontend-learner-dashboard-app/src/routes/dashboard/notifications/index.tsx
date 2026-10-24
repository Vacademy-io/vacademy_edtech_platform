import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import {NotificationList} from "../-components/NotificationsList"

export const Route = createFileRoute('/dashboard/notifications/')({
  component: RouteComponent,
})

function RouteComponent() {
    const { t } = useTranslation("dashboard");
    const { setNavHeading } = useNavHeadingStore();
    // `t` in deps so the heading re-resolves when the learner switches language.
    useEffect(() => {
      setNavHeading(t("notifications.navHeading"));
    }, [t, setNavHeading]);
  return (
    // Every other dashboard route renders inside LayoutContainer; this one did
    // not, which is why the sidebar and navbar were missing here — the page
    // rendered as a bare full-bleed surface with no way back out.
    <LayoutContainer>
      <NotificationList/>
    </LayoutContainer>
  );
}
