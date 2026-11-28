import { createLazyFileRoute } from "@tanstack/react-router"
import SortTopicQuestions from "./-components/SortTopicQuestions"
import { AICenterProvider } from "@/routes/ai-center/-contexts/useAICenterContext"
import { LayoutContainer } from "@/components/common/layout-container/layout-container"
import { CaretLeft } from "@phosphor-icons/react"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore"

export const Route = createLazyFileRoute("/ai-center/ai-tools/vsmart-sorter/")({
  component: RouteComponent,
})

function RouteComponent() {
  const { t } = useTranslation("aiCenterVsmartSorterIndex")
  const { setNavHeading } = useNavHeadingStore()
  useEffect(() => {
    const heading = (
      <div className="flex items-center gap-4">
        <CaretLeft
          onClick={() => window.history.back()}
          className="cursor-pointer"
        />
        <div>{t("navHeading")}</div>
      </div>
    )

    setNavHeading(heading)
  }, [t])
  return (
    <LayoutContainer>
      <AICenterProvider>
        <SortTopicQuestions />
      </AICenterProvider>
    </LayoutContainer>
  )
}
