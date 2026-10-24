import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/engagement/history` was the old "Past tasks" page. It now lives on the
 * `/engagement` page's Past tab; old links, bookmarks and the sidebar land there.
 */
export const Route = createFileRoute("/engagement/history/")({
  beforeLoad: () => {
    throw redirect({ to: "/engagement", search: { tab: "past" }, replace: true });
  },
});
