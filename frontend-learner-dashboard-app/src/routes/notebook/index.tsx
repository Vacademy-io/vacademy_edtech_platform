import { createFileRoute } from "@tanstack/react-router";
import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { NotebookPage } from "@/components/notebook/NotebookPage";

export const Route = createFileRoute("/notebook/")({
  component: () => (
    <LayoutContainer>
      <NotebookPage />
    </LayoutContainer>
  ),
});
