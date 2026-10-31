import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { getMyFiles } from "@/services/system-files-api";
import { Folder, FolderOpen, CaretRight } from "@phosphor-icons/react";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import { EmptyState, ErrorState, LoadingState } from "@/components/design-system/states";
import { cn } from "@/lib/utils";
import type { SystemFile } from "@/types/system-files";

export const Route = createFileRoute("/my-files/")({
  component: RouteComponent,
});

function RouteComponent() {
  const navigate = useNavigate();
  const { setNavHeading } = useNavHeadingStore();

  useEffect(() => {
    setNavHeading("My Files");
  }, [setNavHeading]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["my-files"],
    queryFn: () => getMyFiles({}),
  });

  const handleFolderClick = (folderName: string) => {
    // Encode the folder name for URL
    const encodedFolderName = encodeURIComponent(folderName);
    navigate({ to: `/my-files/${encodedFolderName}` });
  };

  if (isLoading) {
    return (
      <LayoutContainer>
        <LoadingState variant="cards" count={8} className="xl:grid-cols-4" />
      </LayoutContainer>
    );
  }

  if (error) {
    return (
      <LayoutContainer>
        <ErrorState
          title="Could not load your files"
          message="Something went wrong while loading your folders."
          onRetry={() => refetch()}
        />
      </LayoutContainer>
    );
  }

  const files = data?.files || [];

  // Group files by folder_name and get unique folders
  const folderMap = new Map<string, SystemFile[]>();
  files.forEach((file) => {
    if (file.folder_name) {
      if (!folderMap.has(file.folder_name)) {
        folderMap.set(file.folder_name, []);
      }
      folderMap.get(file.folder_name)!.push(file);
    }
  });

  const folders = Array.from(folderMap.entries()).map(([name, folderFiles]) => ({
    name,
    fileCount: folderFiles.length,
  }));

  if (folders.length === 0) {
    return (
      <LayoutContainer>
        <EmptyState
          icon={FolderOpen}
          title="No files yet"
          description="Files shared with you will appear here."
        />
      </LayoutContainer>
    );
  }

  return (
    <LayoutContainer>
      <div className="grid grid-cols-1 gap-stack sm:grid-cols-2 md:gap-4 lg:grid-cols-3 xl:grid-cols-4">
        {folders.map((folder) => (
          <button
            key={folder.name}
            type="button"
            onClick={() => handleFolderClick(folder.name)}
            aria-label={`Open folder ${folder.name}`}
            className={cn(
              "group flex min-h-11 items-center gap-3 rounded-lg border border-neutral-200 bg-white p-4 text-start transition-colors",
              "hover:border-primary-300 hover:bg-primary-50/40",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2",
            )}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
              <Folder size={20} weight="duotone" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-body font-medium text-neutral-700">
                {folder.name}
              </span>
              <span className="text-caption text-neutral-500 tabular-nums">
                {folder.fileCount === 1 ? "1 file" : `${folder.fileCount} files`}
              </span>
            </span>
            <CaretRight
              size={16}
              className="shrink-0 text-neutral-300 transition-colors group-hover:text-primary-500"
            />
          </button>
        ))}
      </div>
    </LayoutContainer>
  );
}
