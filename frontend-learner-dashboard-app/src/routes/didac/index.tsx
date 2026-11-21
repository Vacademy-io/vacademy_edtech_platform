import { createFileRoute, redirect } from "@tanstack/react-router";
import { parseStudioSearch, type StudioSearch } from "@/components/tutor/StudioPage";

/** DIDAC India 2026: the stall's short link to Tutezy Studio. */
export const Route = createFileRoute("/didac/")({
  validateSearch: (search: Record<string, unknown>): StudioSearch => parseStudioSearch(search),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/studio", search: search as never, replace: true });
  },
});
