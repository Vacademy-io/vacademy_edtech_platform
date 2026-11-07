import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { ScheduleTestMainComponent } from "@/routes/assessment/examination/-components/ScheduleTestMainComponent";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const listSearchSchema = z.object({
  /** Assessment folder id, or "others"; absent = the folder cards (or the flat list). */
  folderId: z.string().optional(),
})
  // Keep any other params (e.g. isPublicAssessment) that callers pass along.
  .passthrough();

export const Route = createFileRoute("/assessment/list/")({
  validateSearch: (search) => listSearchSchema.parse(search),
  component: RouteComponent,
});

function RouteComponent() {
  const { folderId } = Route.useSearch();
  return (
    <LayoutContainer>
      <ScheduleTestMainComponent
        key={folderId ?? "root"}
        assessment_types="ASSESSMENT"
        folderId={folderId}
      />
    </LayoutContainer>
  );
}
