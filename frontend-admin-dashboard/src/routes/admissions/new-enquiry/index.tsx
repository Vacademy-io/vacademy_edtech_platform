import { createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/admissions/new-enquiry/")({
  component: RouteComponent,
})

function RouteComponent() {
  const { t } = useTranslation("admissionsNewEnquiryIndex")
  return <div>{t("placeholder")}</div>
}
