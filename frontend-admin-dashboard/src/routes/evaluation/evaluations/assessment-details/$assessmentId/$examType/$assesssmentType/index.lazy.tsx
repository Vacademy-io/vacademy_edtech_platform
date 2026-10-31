import { createLazyFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"

export const Route = createLazyFileRoute(
  "/evaluation/evaluations/assessment-details/$assessmentId/$examType/$assesssmentType/",
)({
  component: RouteComponent,
})

function RouteComponent() {
  const { t } = useTranslation("evaluationAssessmentDetailsIndex")
  return (
    <div>
      {t("greeting")}
      "/evaluation/evaluations/assessment-details/$assessmentId/$examType/$assesssmentType/"!
    </div>
  )
}
