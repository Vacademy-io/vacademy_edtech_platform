import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import React, { useState, useEffect } from "react";
import { getMyFiles } from "@/services/system-files-api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { NotePreviewDialog } from "@/components/common/my-files/note-preview-dialog";
import type { SystemFile } from "@/types/system-files";
import { Eye, DownloadSimple, PencilSimple, FileText, LinkSimple, File, ArrowLeft } from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { X } from "@phosphor-icons/react";

export const Route = createFileRoute("/my-files/$folderName/")({
  component: RouteComponent,
});

function RouteComponent() {
  const navigate = useNavigate();
  const [selectedNote, setSelectedNote] = useState<{
    title: string;
    content: string;
  } | null>(null);

  // Get and decode the folder name from URL
  const params = Route.useParams();
  
  // Sometimes during SPA navigation, params might be undefined momentarily
  // In that case, fall back to parsing the URL directly
  let folderName = params.folderName || "";
  
  if (!folderName) {
    // Fallback: Parse params from URL directly
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    // URL structure: /my-files/$folderName
    if (pathParts.length >= 2 && pathParts[0] === 'my-files') {
      folderName = pathParts[1] || "";
    }
  }
  
  // Safely decode the folder name
  let decodedFolderName: string;
  try {
    decodedFolderName = decodeURIComponent(folderName);
  } catch (error) {
    console.error("Error decoding folder name:", error);
    decodedFolderName = folderName; // Fallback to raw value
  }

  // Query must be called unconditionally (React hooks rule)
  // Use enabled option to skip the query when folderName is empty
  const { data, isLoading, error } = useQuery({
    queryKey: ["my-files", decodedFolderName],
    queryFn: () => getMyFiles({}),
    retry: 1,
    retryDelay: 1000,
    enabled: !!folderName, // Only run query when we have a folder name
  });

  // If no folder name, redirect back
  useEffect(() => {
    if (!folderName) {
      navigate({ to: "/my-files" });
    }
  }, [folderName, navigate]);

  if (!folderName) {
    return <DashboardLoader />;
  }

  const formatDate = (isoDate: string) => {
    const date = new Date(isoDate);
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  const handleViewClick = (file: SystemFile) => {
    if (file.file_type === "Url") {
      window.open(file.data, "_blank");
    } else if (file.file_type === "Html") {
      setSelectedNote({
        title: file.name,
        content: file.data,
      });
    }
  };

  const handleDownloadClick = async (file: SystemFile) => {
    try {
      // For File type, the data field contains the S3 fileId
      // We need to get the public URL from S3
      const { getPublicUrl } = await import("@/services/upload_file");
      const publicUrl = await getPublicUrl(file.data);
      window.open(publicUrl, "_blank");
    } catch (error) {
      console.error("Error downloading file:", error);
      // Fallback to direct URL if getPublicUrl fails
      window.open(file.data, "_blank");
    }
  };

  const handleEditClick = (file: SystemFile) => {
    // TODO: Implement edit functionality
    console.log("Edit file:", file);
  };

  const hasViewAccess = (file: SystemFile) => {
    return file.access_types.includes("view");
  };

  const hasEditAccess = (file: SystemFile) => {
    return file.access_types.includes("edit");
  };

  const canShowViewButton = (file: SystemFile) => {
    return (
      hasViewAccess(file) &&
      (file.file_type === "Url" || file.file_type === "Html")
    );
  };

  const canShowDownloadButton = (file: SystemFile) => {
    return hasViewAccess(file) && file.file_type === "File";
  };

  const getFileIcon = (fileType: string) => {
    switch (fileType) {
      case "Html":
        return <FileText className="h-4 w-4 text-blue-500" />;
      case "Url":
        return <LinkSimple className="h-4 w-4 text-green-500" />;
      case "File":
        return <File className="h-4 w-4 text-purple-500" />;
      default:
        return <File className="h-4 w-4 text-gray-500" />;
    }
  };

  const handleBack = () => {
    navigate({ to: "/my-files" });
  };

  if (isLoading) {
    return <DashboardLoader />;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center space-y-2">
          <h2 className="text-xl font-semibold text-neutral-700">
            Error Loading Files
          </h2>
          <p className="text-neutral-500">Please try again later.</p>
        </div>
      </div>
    );
  }

  const allFiles = data?.files || [];
  // Filter files by folder name
  const files = allFiles.filter(
    (file) => file.folder_name === decodedFolderName
  );

  if (files.length === 0) {
    return (
      <LayoutContainer className="!m-0 !p-0 max-w-none">
        <div className="min-h-screen bg-gray-50/50 pb-24 md:pb-8">
          {/* Header */}
          <div className="bg-white border-b border-gray-200 sticky top-0 z-30">
            <div className="w-full py-4 px-4">
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-4">
                  <button
                    onClick={handleBack}
                    className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-600"
                  >
                    <ArrowLeft size={24} />
                  </button>
                  <h1 className="text-xl md:text-2xl font-bold text-gray-900">
                    {decodedFolderName}
                  </h1>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center min-h-96">
            <div className="text-center space-y-2">
              <h2 className="text-xl font-semibold text-neutral-700">
                No Files Found
              </h2>
              <p className="text-neutral-500">
                This folder doesn't contain any files.
              </p>
            </div>
          </div>
        </div>
      </LayoutContainer>
    );
  }

  return (
    <LayoutContainer className="!m-0 !p-0 max-w-none">
      <div className="min-h-screen bg-gray-50/50 pb-24 md:pb-8">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="w-full py-4 px-4">
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-4">
                <button
                  onClick={handleBack}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-600 md:hidden"
                >
                  <X size={24} />
                </button>
                <button
                  onClick={handleBack}
                  className="hidden md:flex items-center gap-2 p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-600"
                >
                  <ArrowLeft size={20} />
                  <span>Back to Folders</span>
                </button>
                <h1 className="text-xl md:text-2xl font-bold text-gray-900">
                  {decodedFolderName}
                </h1>
              </div>
            </div>
          </div>
        </div>

        {/* Desktop Table View */}
        <div className="hidden lg:block py-6 md:py-8 px-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary-100 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/20">
                  <TableHead className="font-semibold text-primary-900 dark:text-primary-100">
                    Name
                  </TableHead>
                  <TableHead className="font-semibold text-primary-900 dark:text-primary-100">
                    Type
                  </TableHead>
                  <TableHead className="font-semibold text-primary-900 dark:text-primary-100">
                    Media Type
                  </TableHead>
                  <TableHead className="font-semibold text-primary-900 dark:text-primary-100">
                    Added By
                  </TableHead>
                  <TableHead className="font-semibold text-primary-900 dark:text-primary-100">
                    Date Added
                  </TableHead>
                  <TableHead className="text-end font-semibold text-primary-900 dark:text-primary-100">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((file) => (
                  <TableRow
                    key={file.id}
                    className="hover:bg-gray-50 dark:hover:bg-neutral-900/50 transition-colors"
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {getFileIcon(file.file_type)}
                        <span className="truncate max-w-xs">{file.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-xs font-medium">
                        {file.file_type === "Html" ? "Note" : file.file_type}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="capitalize text-gray-600 dark:text-gray-400">
                        {file.media_type === "note" ? "Text" : file.media_type}
                      </span>
                    </TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-400">
                      {file.created_by}
                    </TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-400 text-sm">
                      {formatDate(file.created_at_iso)}
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-2">
                        {canShowViewButton(file) && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewClick(file)}
                            title={
                              file.file_type === "Url" ? "Open URL" : "View Note"
                            }
                            className="gap-1.5"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span className="hidden xl:inline">View</span>
                          </Button>
                        )}
                        {canShowDownloadButton(file) && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDownloadClick(file)}
                            title="Download File"
                            className="gap-1.5"
                          >
                            <DownloadSimple className="h-3.5 w-3.5" />
                            <span className="hidden xl:inline">Download</span>
                          </Button>
                        )}
                        {hasEditAccess(file) && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEditClick(file)}
                            title="Edit File"
                            className="gap-1.5"
                          >
                            <PencilSimple className="h-3.5 w-3.5" />
                            <span className="hidden xl:inline">Edit</span>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Tablet & Mobile Card View */}
        <div className="lg:hidden grid gap-4 py-6 px-2">
          {files.map((file) => (
            <Card
              key={file.id}
              className="border border-gray-200 dark:border-neutral-800 hover:shadow-md transition-all duration-200 hover:border-primary-300 dark:hover:border-primary-700"
            >
              <CardContent className="p-card">
                {/* Header with icon and name */}
                <div className="flex items-start gap-3 mb-3">
                  <div className="mt-1">{getFileIcon(file.file_type)}</div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <h3 className="font-semibold text-gray-900 dark:text-white break-words">
                      {file.name}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-xs font-medium">
                        {file.file_type === "Html" ? "Note" : file.file_type}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                        {file.media_type === "note" ? "Text" : file.media_type}
                      </span>
                    </div>
                  </div>
                </div>

                {/* File Details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-stack mb-4 text-sm">
                  <div className="space-y-1">
                    <span className="text-gray-500 dark:text-gray-400 block">
                      Added By
                    </span>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {file.created_by}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-gray-500 dark:text-gray-400 block">
                      Date Added
                    </span>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {formatDate(file.created_at_iso)}
                    </p>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100 dark:border-neutral-800">
                  {canShowViewButton(file) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleViewClick(file)}
                      title={file.file_type === "Url" ? "Open URL" : "View Note"}
                      className="flex-1 min-w-24 gap-2"
                    >
                      <Eye className="h-4 w-4" />
                      View
                    </Button>
                  )}
                  {canShowDownloadButton(file) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownloadClick(file)}
                      title="Download File"
                      className="flex-1 min-w-24 gap-2"
                    >
                      <DownloadSimple className="h-4 w-4" />
                      Download
                    </Button>
                  )}
                  {hasEditAccess(file) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEditClick(file)}
                      title="Edit File"
                      className="flex-1 min-w-24 gap-2"
                    >
                      <PencilSimple className="h-4 w-4" />
                      Edit
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <NotePreviewDialog
          open={selectedNote !== null}
          onOpenChange={(open) => !open && setSelectedNote(null)}
          title={selectedNote?.title || ""}
          htmlContent={selectedNote?.content || ""}
        />
      </div>
    </LayoutContainer>
  );
}

