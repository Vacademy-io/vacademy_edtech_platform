import { createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute(
  "/study-library/ai-copilot/shared/components/YouTubePlayerSimple",
)({
  component: RouteComponent,
})

function RouteComponent() {
  const { t } = useTranslation("studyLibraryYouTubePlayerSimple")
  return (
    <div>
      {t("placeholder")}
    </div>
  )
}
