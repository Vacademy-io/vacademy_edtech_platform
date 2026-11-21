import { createFileRoute } from "@tanstack/react-router";
import { parseStudioSearch, StudioPage, type StudioSearch } from "@/components/tutor/StudioPage";

/** Tutezy Studio: a live lesson from any topic, PDF or YouTube link (stall kiosk and visitors' phones). */
export const Route = createFileRoute("/studio/")({
  component: StudioRoute,
  validateSearch: (search: Record<string, unknown>): StudioSearch => parseStudioSearch(search),
});

function StudioRoute() {
  return <StudioPage search={Route.useSearch()} />;
}
