import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { ScheduleTestMainComponent } from "./-components/ScheduleTestMainComponent";
// import { Helmet } from "react-helmet";
import { TokenKey } from "@/constants/auth/tokens";
import { getTokenFromStorage } from "@/lib/auth/sessionUtility";
import { getFromStorage } from "@/components/common/auth/login/forms/page/login-form";
import { z } from "zod";

const examinationSearchSchema = z.object({
  /** Assessment folder id, or "others"; absent = the folder cards (or the flat list). */
  folderId: z.string().optional(),
})
  // Keep any other params (e.g. isPublicAssessment) that callers pass along.
  .passthrough();

export const Route = createFileRoute("/assessment/examination/")({
  validateSearch: (search) => examinationSearchSchema.parse(search),
  beforeLoad: async ({ location }) => {
    const token = await getTokenFromStorage(TokenKey.accessToken);
    const studentDetails = await getFromStorage("StudentDetails");
    const instituteDetails = await getFromStorage("InstituteDetails");
    const isPublicAssessment = location.search
      ? new URLSearchParams(location.search).get("isPublicAssessment")
      : undefined;
    // If any of the required details are missing, redirect to login
    if (!token || !studentDetails || !instituteDetails) {
      throw redirect({
        to: "/login",
        search: { redirect: location.pathname, isPublicAssessment },
      });
    }
  },
  component: ExaminationRoute,
});

function ExaminationRoute() {
  const { folderId } = Route.useSearch();
  return (
    <LayoutContainer>
      {/* <Helmet>
        <title>{document?.title || "Assessment"}</title>
        <meta name="description" content="Assessment page" />
      </Helmet> */}
      <ScheduleTestMainComponent
        key={folderId ?? "root"}
        assessment_types="ASSESSMENT"
        folderId={folderId}
      />
    </LayoutContainer>
  );
}
