import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    UploadSimple,
    Link,
    Note,
    FilePdf,
    FileDoc,
    FileVideo,
    FileAudio,
    FileImage,
    File,
    DownloadSimple,
    Trash,
    ArrowSquareOut,
    CalendarBlank,
    User,
    X,
    Spinner,
    FolderOpen,
    Eye,
    Gear,
    ArrowClockwise,
    Plus,
    UserCheck,
    UserMinus,
    type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { useStudentSidebar } from '../../../../-context/selected-student-sidebar-context';
import { toast } from 'sonner';
import { getPublicUrl } from '@/services/upload_file';
import {
    addFileForStudent,
    getStudentFiles,
    deleteSystemFile,
    createHtmlSystemFile,
    detectMediaTypeFromFile,
    grantUserAccess,
    revokeUserAccess,
    getFileAccessDetails,
    type SystemFile,
    type MediaType,
    type FileType,
} from '@/services/system-files';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { cn } from '@/lib/utils';
import {
    ProfileSectionCard,
    ProfileSkeleton,
    ProfileEmpty,
    ProfileError,
    ProfileHeroStat,
    ProfileActionBar,
} from '../profile-ui';

// ── Media type config ─────────────────────────────────────────────────────────

type MediaTypeConfig = {
    value: MediaType;
    label: string;
    icon: PhosphorIcon;
    /** Token classes for the icon chip */
    chipClass: string;
};

const buildMediaTypes = (t: TFunction): MediaTypeConfig[] => [
    {
        value: 'video',
        label: t('mediaTypes.video'),
        icon: FileVideo,
        chipClass: 'bg-primary-50 border-primary-200 text-primary-700',
    },
    {
        value: 'audio',
        label: t('mediaTypes.audio'),
        icon: FileAudio,
        chipClass: 'bg-info-50 border-info-200 text-info-700',
    },
    {
        value: 'pdf',
        label: t('mediaTypes.pdf'),
        icon: FilePdf,
        chipClass: 'bg-danger-50 border-danger-200 text-danger-700',
    },
    {
        value: 'doc',
        label: t('mediaTypes.doc'),
        icon: FileDoc,
        chipClass: 'bg-primary-50 border-primary-200 text-primary-700',
    },
    {
        value: 'image',
        label: t('mediaTypes.image'),
        icon: FileImage,
        chipClass: 'bg-warning-50 border-warning-200 text-warning-700',
    },
    {
        value: 'note',
        label: t('mediaTypes.note'),
        icon: Note,
        chipClass: 'bg-warning-50 border-warning-100 text-warning-700',
    },
    {
        value: 'unknown',
        label: t('mediaTypes.other'),
        icon: File,
        chipClass: 'bg-neutral-100 border-neutral-200 text-neutral-600',
    },
];

const buildMediaTypeMap = (mediaTypes: MediaTypeConfig[]): Record<MediaType, MediaTypeConfig> =>
    Object.fromEntries(mediaTypes.map((m) => [m.value, m])) as Record<MediaType, MediaTypeConfig>;

// ── File type tabs ─────────────────────────────────────────────────────────────

type FileTypeTab = 'File' | 'Url' | 'Note';

// Internal key lookups (not translated strings themselves — safe as static maps)
const FILE_TYPE_TAB_LABEL_KEYS: Record<FileTypeTab, string> = {
    File: 'addDialog.tabs.file',
    Url: 'addDialog.tabs.url',
    Note: 'addDialog.tabs.note',
};

const FILE_TYPE_LABEL_KEYS: Record<FileType, string> = {
    File: 'fileTypes.file',
    Url: 'fileTypes.url',
    Html: 'fileTypes.note',
};

// ── Grouped files by folder ────────────────────────────────────────────────────

type GroupedFiles = {
    [folderName: string]: SystemFile[];
};

// ── Helper: icon for media type ────────────────────────────────────────────────

const MediaIcon = ({
    mediaType,
    className,
    mediaTypeMap,
}: {
    mediaType: MediaType;
    className?: string;
    mediaTypeMap: Record<MediaType, MediaTypeConfig>;
}) => {
    const cfg = mediaTypeMap[mediaType] ?? mediaTypeMap.unknown;
    const Icon = cfg.icon;
    return <Icon className={className ?? 'size-5'} />;
};

// ── Helper: format date ────────────────────────────────────────────────────────

const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
};

// ── Helper: group files by folder (case-insensitive) ──────────────────────────

const groupFilesByFolder = (files: SystemFile[]): GroupedFiles => {
    const grouped: GroupedFiles = {};
    files.forEach((file) => {
        const folder = file.folder_name || 'Uncategorized';
        const folderKey = folder.toLowerCase();
        if (!grouped[folderKey]) {
            grouped[folderKey] = [];
        }
        grouped[folderKey]?.push(file);
    });
    return grouped;
};

// ── File row ───────────────────────────────────────────────────────────────────

const FileRow = ({
    file,
    onView,
    onDownload,
    onManageAccess,
    onDelete,
    mediaTypeMap,
}: {
    file: SystemFile;
    onView: (f: SystemFile) => void;
    onDownload: (f: SystemFile) => void;
    onManageAccess: (f: SystemFile) => void;
    onDelete: (id: string) => void;
    mediaTypeMap: Record<MediaType, MediaTypeConfig>;
}) => {
    const { t } = useTranslation('manageStudentsFiles');
    const cfg = mediaTypeMap[file.media_type] ?? mediaTypeMap.unknown;

    return (
        <div className="group flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3 transition-shadow hover:shadow-sm">
            {/* Type chip */}
            <span
                className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-md border',
                    cfg.chipClass
                )}
            >
                <MediaIcon mediaType={file.media_type} className="size-4" mediaTypeMap={mediaTypeMap} />
            </span>

            {/* Name + meta */}
            <div className="min-w-0 flex-1">
                <p
                    className="truncate text-sm font-medium text-neutral-800"
                    title={file.name}
                >
                    {file.name}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-neutral-500">
                    <span>{cfg.label}</span>
                    <span aria-hidden>·</span>
                    <span className="flex items-center gap-1">
                        <User className="size-3" />
                        {file.created_by}
                    </span>
                    <span aria-hidden>·</span>
                    <span className="flex items-center gap-1">
                        <CalendarBlank className="size-3" />
                        {formatDate(file.created_at_iso)}
                    </span>
                </div>
            </div>

            {/* Row actions — visible on hover, always accessible via keyboard */}
            <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                {file.file_type === 'Html' ? (
                    <MyButton
                        buttonType="text"
                        scale="small"
                        onClick={(e) => {
                            e.stopPropagation();
                            onView(file);
                        }}
                        title={t('row.viewNote')}
                    >
                        <Eye className="size-3.5" />
                    </MyButton>
                ) : (
                    <MyButton
                        buttonType="text"
                        scale="small"
                        onClick={(e) => {
                            e.stopPropagation();
                            onDownload(file);
                        }}
                        title={file.file_type === 'File' ? t('row.download') : t('row.openLink')}
                    >
                        {file.file_type === 'File' ? (
                            <DownloadSimple className="size-3.5" />
                        ) : (
                            <ArrowSquareOut className="size-3.5" />
                        )}
                    </MyButton>
                )}
                <MyButton
                    buttonType="text"
                    scale="small"
                    onClick={(e) => {
                        e.stopPropagation();
                        onManageAccess(file);
                    }}
                    title={t('row.manageAccess')}
                >
                    <Gear className="size-3.5" />
                </MyButton>
                <MyButton
                    buttonType="text"
                    scale="small"
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete(file.id);
                    }}
                    title={t('row.delete')}
                >
                    <Trash className="size-3.5 text-danger-500" />
                </MyButton>
            </div>
        </div>
    );
};

// ── Main component ─────────────────────────────────────────────────────────────

export const StudentFiles = () => {
    const { t } = useTranslation('manageStudentsFiles');
    const { selectedStudent } = useStudentSidebar();

    const mediaTypes = useMemo(() => buildMediaTypes(t), [t]);
    const mediaTypeMap = useMemo(() => buildMediaTypeMap(mediaTypes), [mediaTypes]);

    // Dialog state
    const [showAddDialog, setShowAddDialog] = useState(false);
    const [fileTypeTab, setFileTypeTab] = useState<FileTypeTab>('File');

    // Form state
    const [fileName, setFileName] = useState('');
    const [fileUrl, setFileUrl] = useState('');
    const [folderName, setFolderName] = useState('');
    const [isFolderNameReadonly, setIsFolderNameReadonly] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [mediaType, setMediaType] = useState<MediaType>('unknown');
    const [htmlContent, setHtmlContent] = useState('');
    const [grantEditAccess, setGrantEditAccess] = useState(false);

    // Loading / error states
    const [isUploading, setIsUploading] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [loadError, setLoadError] = useState(false);

    // Files data
    const [files, setFiles] = useState<SystemFile[]>([]);

    // View note dialog state
    const [showViewNoteDialog, setShowViewNoteDialog] = useState(false);
    const [viewingNote, setViewingNote] = useState<SystemFile | null>(null);

    // Delete confirmation dialog state
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [fileToDelete, setFileToDelete] = useState<string | null>(null);

    // Access management dialog state
    const [showAccessDialog, setShowAccessDialog] = useState(false);
    const [editingFile, setEditingFile] = useState<SystemFile | null>(null);
    const [hasViewAccess, setHasViewAccess] = useState(false);
    const [hasEditAccess, setHasEditAccess] = useState(false);
    const [isLoadingAccess, setIsLoadingAccess] = useState(false);

    // Load student files
    const loadStudentFiles = async () => {
        if (!selectedStudent?.user_id || !selectedStudent?.institute_id) {
            return;
        }

        try {
            setIsLoading(true);
            setLoadError(false);
            console.log('selectedStudent:', selectedStudent);
            const response = await getStudentFiles(
                selectedStudent.user_id,
                selectedStudent.institute_id
            );
            setFiles(response);
        } catch (error) {
            console.error('Error loading student files:', error);
            setLoadError(true);
            toast.error(t('toasts.loadFilesFailed'));
        } finally {
            setIsLoading(false);
        }
    };

    // Load files on mount and when student changes
    useEffect(() => {
        loadStudentFiles();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedStudent?.user_id, selectedStudent?.institute_id]);

    // Handle file selection with auto-detect media type
    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            const detectedType = detectMediaTypeFromFile(file);
            setMediaType(detectedType);
            if (!fileName) {
                const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
                setFileName(nameWithoutExt);
            }
        }
    };

    // Handle add file submission
    const handleAddFile = async () => {
        if (!selectedStudent?.user_id || !selectedStudent?.institute_id) {
            toast.error(t('toasts.noStudentSelected'));
            return;
        }

        if (!fileName.trim()) {
            toast.error(t('toasts.enterFileName'));
            return;
        }

        try {
            setIsUploading(true);

            const fileData: {
                name: string;
                folder_name?: string;
                media_type: MediaType;
                url?: string;
                file_type?: FileType;
            } = {
                name: fileName,
                folder_name: folderName || undefined,
                media_type: fileTypeTab === 'Note' ? 'note' : mediaType,
            };

            if (fileTypeTab === 'File') {
                if (!selectedFile) {
                    toast.error(t('toasts.selectFile'));
                    return;
                }
                fileData.file_type = 'File';
                await addFileForStudent(
                    selectedFile,
                    selectedStudent.user_id,
                    selectedStudent.institute_id,
                    fileData,
                    setIsUploading
                );
                toast.success(t('toasts.fileUploaded'));
            } else if (fileTypeTab === 'Url') {
                if (!fileUrl.trim()) {
                    toast.error(t('toasts.enterUrl'));
                    return;
                }
                fileData.file_type = 'Url';
                fileData.url = fileUrl;
                await addFileForStudent(
                    null,
                    selectedStudent.user_id,
                    selectedStudent.institute_id,
                    fileData,
                    setIsUploading
                );
                toast.success(t('toasts.urlAdded'));
            } else if (fileTypeTab === 'Note') {
                if (!htmlContent.trim()) {
                    toast.error(t('toasts.enterNoteContent'));
                    return;
                }
                await createHtmlSystemFile(
                    selectedStudent.institute_id,
                    {
                        html: htmlContent,
                        name: fileName,
                        folder_name: folderName || undefined,
                        view_access: [
                            {
                                level: 'user',
                                level_id: selectedStudent.user_id,
                            },
                        ],
                        edit_access: grantEditAccess
                            ? [
                                  {
                                      level: 'user',
                                      level_id: selectedStudent.user_id,
                                  },
                                  {
                                      level: 'role',
                                      level_id: 'Admin',
                                  },
                              ]
                            : [
                                  {
                                      level: 'role',
                                      level_id: 'Admin',
                                  },
                              ],
                    },
                    selectedStudent.user_id
                );
                toast.success(t('toasts.noteCreated'));
            }

            await loadStudentFiles();
            setShowAddDialog(false);
            resetForm();
        } catch (error) {
            console.error('Error adding file:', error);
            toast.error(t('toasts.addFileFailed'));
        } finally {
            setIsUploading(false);
        }
    };

    // Handle delete file
    const handleDeleteFile = async (fileId: string) => {
        if (!selectedStudent?.institute_id) return;
        try {
            await deleteSystemFile(fileId, selectedStudent.institute_id);
            toast.success(t('toasts.fileDeleted'));
            await loadStudentFiles();
        } catch (error) {
            console.error('Error deleting file:', error);
            toast.error(t('toasts.deleteFileFailed'));
        } finally {
            setShowDeleteDialog(false);
            setFileToDelete(null);
        }
    };

    // Handle delete click
    const handleDeleteClick = (fileId: string) => {
        setFileToDelete(fileId);
        setShowDeleteDialog(true);
    };

    // Handle refresh files
    const handleRefresh = async () => {
        setIsRefreshing(true);
        await loadStudentFiles();
        setIsRefreshing(false);
        toast.success(t('toasts.filesRefreshed'));
    };

    // Handle view note
    const handleViewNote = (file: SystemFile) => {
        setViewingNote(file);
        setShowViewNoteDialog(true);
    };

    // Handle manage access
    const handleManageAccess = async (file: SystemFile) => {
        if (!selectedStudent?.user_id || !selectedStudent?.institute_id) return;
        try {
            setIsLoadingAccess(true);
            setEditingFile(file);
            setShowAccessDialog(true);
            const fileDetails = await getFileAccessDetails(file.id, selectedStudent.institute_id);
            const studentViewAccess = fileDetails.access_list.some(
                (access) =>
                    access.level === 'user' &&
                    access.level_id === selectedStudent.user_id &&
                    access.access_type === 'view'
            );
            const studentEditAccess = fileDetails.access_list.some(
                (access) =>
                    access.level === 'user' &&
                    access.level_id === selectedStudent.user_id &&
                    access.access_type === 'edit'
            );
            setHasViewAccess(studentViewAccess);
            setHasEditAccess(studentEditAccess);
        } catch (error) {
            console.error('Error loading file access:', error);
            toast.error(t('toasts.loadAccessFailed'));
            setShowAccessDialog(false);
        } finally {
            setIsLoadingAccess(false);
        }
    };

    // Handle toggle view access
    const handleToggleViewAccess = async () => {
        if (!editingFile || !selectedStudent?.user_id || !selectedStudent?.institute_id) return;
        try {
            setIsLoadingAccess(true);
            if (hasViewAccess) {
                await revokeUserAccess(
                    editingFile.id,
                    selectedStudent.user_id,
                    'view',
                    selectedStudent.institute_id
                );
                setHasViewAccess(false);
                toast.success(t('toasts.viewAccessRevoked'));
            } else {
                await grantUserAccess(
                    editingFile.id,
                    selectedStudent.user_id,
                    'view',
                    selectedStudent.institute_id
                );
                setHasViewAccess(true);
                toast.success(t('toasts.viewAccessGranted'));
            }
            await loadStudentFiles();
        } catch (error) {
            console.error('Error toggling view access:', error);
            toast.error(t('toasts.updateViewAccessFailed'));
        } finally {
            setIsLoadingAccess(false);
        }
    };

    // Handle toggle edit access
    const handleToggleEditAccess = async () => {
        if (!editingFile || !selectedStudent?.user_id || !selectedStudent?.institute_id) return;
        try {
            setIsLoadingAccess(true);
            if (hasEditAccess) {
                await revokeUserAccess(
                    editingFile.id,
                    selectedStudent.user_id,
                    'edit',
                    selectedStudent.institute_id
                );
                setHasEditAccess(false);
                toast.success(t('toasts.editAccessRevoked'));
            } else {
                await grantUserAccess(
                    editingFile.id,
                    selectedStudent.user_id,
                    'edit',
                    selectedStudent.institute_id
                );
                setHasEditAccess(true);
                toast.success(t('toasts.editAccessGranted'));
            }
            await loadStudentFiles();
        } catch (error) {
            console.error('Error toggling edit access:', error);
            toast.error(t('toasts.updateEditAccessFailed'));
        } finally {
            setIsLoadingAccess(false);
        }
    };

    // Handle file download/open
    const handleFileDownload = async (file: SystemFile) => {
        try {
            if (file.file_type === 'File') {
                const publicUrl = await getPublicUrl(file.data);
                if (publicUrl) {
                    window.open(publicUrl, '_blank');
                } else {
                    toast.error(t('toasts.getFileUrlFailed'));
                }
            } else if (file.file_type === 'Url') {
                window.open(file.data, '_blank');
            }
        } catch (error) {
            console.error('Error opening file:', error);
            toast.error(t('toasts.openFileFailed'));
        }
    };

    // Reset form
    const resetForm = () => {
        setFileName('');
        setFileUrl('');
        setFolderName('');
        setIsFolderNameReadonly(false);
        setHtmlContent('');
        setSelectedFile(null);
        setMediaType('unknown');
        setFileTypeTab('File');
        setGrantEditAccess(false);
    };

    // Open add dialog (used by empty-state CTA and header buttons)
    const openAddDialog = (tab: FileTypeTab, preset?: { folderName: string }) => {
        setFileTypeTab(tab);
        if (preset?.folderName) {
            setFolderName(preset.folderName);
            setIsFolderNameReadonly(true);
        }
        setShowAddDialog(true);
    };

    const groupedFiles = groupFilesByFolder(files);
    const folderNames = Object.keys(groupedFiles).sort();

    // ── Derived stats ──────────────────────────────────────────────────────────

    const totalFiles = files.length;
    const totalFolders = folderNames.length;
    // "Recent uploads" = files created in the last 7 days
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentCount = files.filter(
        (f) => new Date(f.created_at_iso).getTime() >= sevenDaysAgo
    ).length;

    // ── Body content ───────────────────────────────────────────────────────────

    let body: React.ReactNode;

    if (isLoading) {
        body = <ProfileSkeleton blocks={3} />;
    } else if (loadError) {
        body = (
            <ProfileError
                title={t('error.title')}
                hint={t('error.hint')}
                onRetry={loadStudentFiles}
            />
        );
    } else if (files.length === 0) {
        body = (
            <ProfileEmpty
                icon={File}
                title={t('empty.title')}
                hint={t('empty.hint')}
                action={
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={(e) => {
                            e.stopPropagation();
                            openAddDialog('File');
                        }}
                    >
                        <Plus className="size-3.5" />
                        {t('empty.addFirstFile')}
                    </MyButton>
                }
            />
        );
    } else {
        body = (
            <div className="flex flex-col gap-4">
                {folderNames.map((folderKey) => {
                    const folderFiles = groupedFiles[folderKey];
                    // @ts-expect-error : Ignore TS error for folder_name
                    const displayFolderName = folderFiles[0]?.folder_name || t('folders.uncategorized');

                    return (
                        <ProfileSectionCard
                            key={folderKey}
                            icon={FolderOpen}
                            heading={displayFolderName}
                            action={
                                <MyButton
                                    buttonType="text"
                                    scale="small"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        openAddDialog('File', {
                                            folderName: displayFolderName,
                                        });
                                    }}
                                >
                                    <Plus className="size-3.5" />
                                    <span className="text-xs">{t('folders.addToFolder')}</span>
                                </MyButton>
                            }
                            bodyClassName="flex flex-col gap-2"
                        >
                            {/* File count badge */}
                            <p className="mb-1 text-xs text-neutral-500">
                                {t('folders.fileCount', { count: folderFiles?.length ?? 0 })}
                            </p>

                            {folderFiles?.map((file) => (
                                <FileRow
                                    key={file.id}
                                    file={file}
                                    onView={handleViewNote}
                                    onDownload={handleFileDownload}
                                    onManageAccess={handleManageAccess}
                                    onDelete={handleDeleteClick}
                                    mediaTypeMap={mediaTypeMap}
                                />
                            ))}
                        </ProfileSectionCard>
                    );
                })}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4 p-4">
            {/* ── Hero stats row (hidden when all-zero per Phase 0.5b) ───────── */}
            {(totalFiles > 0 || totalFolders > 0 || recentCount > 0) && (
                <div className="flex gap-3">
                    <ProfileHeroStat
                        label={t('heroStats.totalFiles')}
                        value={totalFiles}
                        tone="primary"
                        icon={File}
                    />
                    <ProfileHeroStat
                        label={t('heroStats.folders')}
                        value={totalFolders}
                        tone="neutral"
                        icon={FolderOpen}
                    />
                    <ProfileHeroStat
                        label={t('heroStats.recent')}
                        value={recentCount}
                        tone={recentCount > 0 ? 'success' : 'neutral'}
                        icon={CalendarBlank}
                    />
                </div>
            )}

            {/* ── Primary action bar ─────────────────────────────────────────── */}
            <ProfileActionBar>
                <MyButton
                    buttonType="primary"
                    scale="small"
                    onClick={(e) => {
                        e.stopPropagation();
                        openAddDialog('File');
                    }}
                >
                    <UploadSimple className="size-3.5" />
                    {t('actionBar.uploadFile')}
                </MyButton>
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    onClick={(e) => {
                        e.stopPropagation();
                        openAddDialog('Url');
                    }}
                >
                    <Link className="size-3.5" />
                    {t('actionBar.addLink')}
                </MyButton>
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    onClick={(e) => {
                        e.stopPropagation();
                        openAddDialog('Note');
                    }}
                >
                    <Note className="size-3.5" />
                    {t('actionBar.addNote')}
                </MyButton>
                <MyButton
                    buttonType="text"
                    scale="small"
                    onClick={handleRefresh}
                    disable={isRefreshing || isLoading}
                    title={t('actionBar.refreshFiles')}
                >
                    <ArrowClockwise className={cn('size-3.5', isRefreshing && 'animate-spin')} />
                </MyButton>
            </ProfileActionBar>

            {body}

            {/* ── Add File Dialog ──────────────────────────────────────────── */}
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                <DialogContent className="overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-sm font-semibold">
                            {t('addDialog.titleFor', {
                                term: getTerminology(RoleTerms.Learner, SystemTerms.Learner),
                            })}
                        </DialogTitle>
                        <DialogDescription>
                            {t('addDialog.descriptionFor', {
                                term: getTerminology(
                                    RoleTerms.Learner,
                                    SystemTerms.Learner
                                ).toLocaleLowerCase(),
                            })}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex flex-col gap-4 py-2">
                        {/* File Type Tabs */}
                        <Tabs
                            value={fileTypeTab}
                            onValueChange={(v) => setFileTypeTab(v as FileTypeTab)}
                        >
                            <TabsList className="grid w-full grid-cols-3">
                                <TabsTrigger value="File">
                                    <UploadSimple className="mr-2 size-4" />
                                    {t(FILE_TYPE_TAB_LABEL_KEYS.File)}
                                </TabsTrigger>
                                <TabsTrigger value="Url">
                                    <Link className="mr-2 size-4" />
                                    {t(FILE_TYPE_TAB_LABEL_KEYS.Url)}
                                </TabsTrigger>
                                <TabsTrigger value="Note">
                                    <Note className="mr-2 size-4" />
                                    {t(FILE_TYPE_TAB_LABEL_KEYS.Note)}
                                </TabsTrigger>
                            </TabsList>

                            {/* File Upload Tab */}
                            <TabsContent value="File" className="flex flex-col gap-3">
                                <div className="flex flex-col gap-1.5">
                                    <Label htmlFor="file-upload" className="text-xs font-medium text-neutral-700">
                                        {t('addDialog.selectFileLabel')}
                                    </Label>
                                    <div className="flex items-center gap-2">
                                        <Input
                                            id="file-upload"
                                            type="file"
                                            onChange={handleFileSelect}
                                            className="flex-1"
                                        />
                                        {selectedFile && (
                                            <MyButton
                                                buttonType="text"
                                                scale="small"
                                                onClick={() => {
                                                    setSelectedFile(null);
                                                    setMediaType('unknown');
                                                }}
                                            >
                                                <X className="size-4" />
                                            </MyButton>
                                        )}
                                    </div>
                                    {selectedFile && (
                                        <p className="text-xs text-neutral-500">
                                            {t('addDialog.selected', {
                                                name: selectedFile.name,
                                                size: (selectedFile.size / (1024 * 1024)).toFixed(2),
                                            })}
                                        </p>
                                    )}
                                </div>

                                <div className="flex flex-col gap-1.5">
                                    <Label htmlFor="media-type" className="text-xs font-medium text-neutral-700">
                                        {t('addDialog.mediaTypeLabel')}
                                    </Label>
                                    <Select
                                        value={mediaType}
                                        onValueChange={(v) => setMediaType(v as MediaType)}
                                    >
                                        <SelectTrigger id="media-type">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {mediaTypes.map((type) => {
                                                const Icon = type.icon;
                                                return (
                                                    <SelectItem key={type.value} value={type.value}>
                                                        <div className="flex items-center gap-2">
                                                            <Icon className="size-4" />
                                                            {type.label}
                                                        </div>
                                                    </SelectItem>
                                                );
                                            })}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </TabsContent>

                            {/* URL Tab */}
                            <TabsContent value="Url" className="flex flex-col gap-3">
                                <div className="flex flex-col gap-1.5">
                                    <Label htmlFor="file-url" className="text-xs font-medium text-neutral-700">
                                        {t('addDialog.urlLabel')}
                                    </Label>
                                    <Input
                                        id="file-url"
                                        type="url"
                                        placeholder={t('addDialog.urlPlaceholder')}
                                        value={fileUrl}
                                        onChange={(e) => setFileUrl(e.target.value)}
                                    />
                                    <p className="text-xs text-neutral-500">
                                        {t('addDialog.urlHint')}
                                    </p>
                                </div>

                                <div className="flex flex-col gap-1.5">
                                    <Label htmlFor="url-media-type" className="text-xs font-medium text-neutral-700">
                                        {t('addDialog.mediaTypeLabel')}
                                    </Label>
                                    <Select
                                        value={mediaType}
                                        onValueChange={(v) => setMediaType(v as MediaType)}
                                    >
                                        <SelectTrigger id="url-media-type">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {mediaTypes.map((type) => {
                                                const Icon = type.icon;
                                                return (
                                                    <SelectItem key={type.value} value={type.value}>
                                                        <div className="flex items-center gap-2">
                                                            <Icon className="size-4" />
                                                            {type.label}
                                                        </div>
                                                    </SelectItem>
                                                );
                                            })}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </TabsContent>

                            {/* Note Tab */}
                            <TabsContent value="Note" className="flex flex-col gap-3">
                                <div className="flex flex-col gap-1.5">
                                    <Label htmlFor="note-content" className="text-xs font-medium text-neutral-700">
                                        {t('addDialog.noteContentLabel')}
                                    </Label>
                                    <div className="rounded-lg border border-neutral-200">
                                        <RichTextEditor
                                            value={htmlContent}
                                            onChange={setHtmlContent}
                                            placeholder={t('addDialog.notePlaceholder')}
                                        />
                                    </div>
                                    <p className="text-xs text-neutral-500">
                                        {t('addDialog.noteHint')}
                                    </p>
                                </div>
                            </TabsContent>
                        </Tabs>

                        {/* Common Fields */}
                        <div className="flex flex-col gap-3 border-t border-neutral-200 pt-4">
                            <div className="flex flex-col gap-1.5">
                                <Label htmlFor="file-name" className="text-xs font-medium text-neutral-700">
                                    {t('addDialog.fileNameLabel')}
                                </Label>
                                <Input
                                    id="file-name"
                                    type="text"
                                    placeholder={t('addDialog.fileNamePlaceholder')}
                                    value={fileName}
                                    onChange={(e) => setFileName(e.target.value)}
                                />
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <Label htmlFor="folder-name" className="text-xs font-medium text-neutral-700">
                                    {t('addDialog.folderNameLabel')}
                                    {isFolderNameReadonly && (
                                        <Badge variant="secondary" className="ml-2 text-xs">
                                            {t('addDialog.folderNamePreselected')}
                                        </Badge>
                                    )}
                                </Label>
                                <Input
                                    id="folder-name"
                                    type="text"
                                    placeholder={t('addDialog.folderNamePlaceholder')}
                                    value={folderName}
                                    onChange={(e) => setFolderName(e.target.value)}
                                    readOnly={isFolderNameReadonly}
                                    className={cn(
                                        isFolderNameReadonly &&
                                            'cursor-not-allowed bg-neutral-100'
                                    )}
                                />
                                <p className="text-xs text-neutral-500">
                                    {isFolderNameReadonly
                                        ? t('addDialog.folderNameHintPreselected')
                                        : t('addDialog.folderNameHintDefault')}
                                </p>
                            </div>

                            {/* Access Permissions */}
                            <div className="flex items-center gap-2">
                                <Checkbox
                                    id="edit-access"
                                    checked={grantEditAccess}
                                    onCheckedChange={(checked) =>
                                        setGrantEditAccess(checked as boolean)
                                    }
                                />
                                <label
                                    htmlFor="edit-access"
                                    className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                >
                                    {t('addDialog.grantEditAccessLabel')}
                                </label>
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="gap-2">
                        <MyButton
                            buttonType="secondary"
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowAddDialog(false);
                                resetForm();
                            }}
                            disable={isUploading}
                        >
                            {t('addDialog.cancel')}
                        </MyButton>
                        <MyButton
                            onClick={(e) => {
                                e.stopPropagation();
                                handleAddFile();
                            }}
                            disable={
                                isUploading ||
                                !fileName.trim() ||
                                (fileTypeTab === 'File' && !selectedFile) ||
                                (fileTypeTab === 'Url' && !fileUrl.trim()) ||
                                (fileTypeTab === 'Note' && !htmlContent.trim())
                            }
                        >
                            {isUploading ? (
                                <>
                                    <Spinner className="mr-2 size-4 animate-spin" />
                                    {fileTypeTab === 'File'
                                        ? t('addDialog.uploading')
                                        : t('addDialog.adding')}
                                </>
                            ) : (
                                <>
                                    <Plus className="mr-2 size-4" />
                                    {t('addDialog.addSubmit', {
                                        type: t(FILE_TYPE_TAB_LABEL_KEYS[fileTypeTab]),
                                    })}
                                </>
                            )}
                        </MyButton>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── View Note Dialog ─────────────────────────────────────────── */}
            <Dialog open={showViewNoteDialog} onOpenChange={setShowViewNoteDialog}>
                <DialogContent className="overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
                            <Note className="size-4" />
                            {viewingNote?.name || t('viewNoteDialog.titleFallback')}
                        </DialogTitle>
                        <DialogDescription>
                            {t('viewNoteDialog.description')}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex flex-col gap-3 py-2">
                        <div className="rounded-lg border border-neutral-200 bg-white p-4">
                            {viewingNote ? (
                                <div
                                    className="prose prose-sm max-w-none"
                                    dangerouslySetInnerHTML={{ __html: viewingNote.data }}
                                />
                            ) : (
                                <p className="text-sm text-neutral-500">{t('viewNoteDialog.noContent')}</p>
                            )}
                        </div>
                    </div>

                    <DialogFooter>
                        <MyButton
                            buttonType="secondary"
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowViewNoteDialog(false);
                                setViewingNote(null);
                            }}
                        >
                            {t('viewNoteDialog.close')}
                        </MyButton>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Delete Confirmation Dialog ───────────────────────────────── */}
            <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
                            <Trash className="size-4 text-danger-600" />
                            {t('deleteDialog.title')}
                        </DialogTitle>
                        <DialogDescription>
                            {t('deleteDialog.description')}
                        </DialogDescription>
                    </DialogHeader>

                    <DialogFooter className="gap-2">
                        <MyButton
                            buttonType="secondary"
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowDeleteDialog(false);
                                setFileToDelete(null);
                            }}
                        >
                            {t('deleteDialog.cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            onClick={(e) => {
                                e.stopPropagation();
                                fileToDelete && handleDeleteFile(fileToDelete);
                            }}
                        >
                            <Trash className="mr-2 size-4" />
                            {t('deleteDialog.confirm')}
                        </MyButton>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Manage Access Dialog ─────────────────────────────────────── */}
            <Dialog open={showAccessDialog} onOpenChange={setShowAccessDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
                            <Gear className="size-4 text-primary-600" />
                            {t('accessDialog.titleFor', {
                                term: getTerminology(RoleTerms.Learner, SystemTerms.Learner),
                            })}
                        </DialogTitle>
                        <DialogDescription>
                            {t('accessDialog.description')}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex flex-col gap-4 py-2">
                        {isLoadingAccess ? (
                            <div className="flex items-center justify-center py-8">
                                <Spinner className="size-6 animate-spin text-neutral-400" />
                            </div>
                        ) : (
                            <>
                                {/* File Info */}
                                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                                    <div className="flex items-center gap-3">
                                        <span
                                            className={cn(
                                                'flex size-9 items-center justify-center rounded-md border',
                                                editingFile
                                                    ? (mediaTypeMap[editingFile.media_type] ??
                                                          mediaTypeMap.unknown).chipClass
                                                    : 'bg-neutral-100 border-neutral-200'
                                            )}
                                        >
                                            {editingFile && (
                                                <MediaIcon
                                                    mediaType={editingFile.media_type}
                                                    className="size-4"
                                                    mediaTypeMap={mediaTypeMap}
                                                />
                                            )}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <p
                                                className="truncate text-sm font-medium text-neutral-800"
                                                title={editingFile?.name}
                                            >
                                                {editingFile?.name}
                                            </p>
                                            <p className="text-xs text-neutral-500">
                                                {editingFile && t(FILE_TYPE_LABEL_KEYS[editingFile.file_type])} ·{' '}
                                                {editingFile &&
                                                    (mediaTypeMap[editingFile.media_type] ??
                                                        mediaTypeMap.unknown
                                                    ).label}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Student Info */}
                                <div className="rounded-lg border border-primary-100 bg-primary-50 p-3">
                                    <div className="flex items-center gap-2">
                                        <User className="size-4 text-primary-600" />
                                        <span className="text-sm font-medium text-primary-900">
                                            {selectedStudent?.full_name}
                                        </span>
                                    </div>
                                </div>

                                {/* Access Controls */}
                                <div className="flex flex-col gap-2">
                                    {/* View access row */}
                                    <div className="flex items-center justify-between rounded-lg border border-neutral-200 p-3 hover:bg-neutral-50">
                                        <div className="flex items-center gap-3">
                                            <UserCheck className="size-5 text-success-600" />
                                            <div>
                                                <p className="text-sm font-medium text-neutral-800">
                                                    {t('accessDialog.viewAccessTitle')}
                                                </p>
                                                <p className="text-xs text-neutral-500">
                                                    {t('accessDialog.viewAccessHint', {
                                                        term: getTerminology(
                                                            RoleTerms.Learner,
                                                            SystemTerms.Learner
                                                        ),
                                                    })}
                                                </p>
                                            </div>
                                        </div>
                                        <MyButton
                                            buttonType={hasViewAccess ? 'primary' : 'secondary'}
                                            scale="small"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleToggleViewAccess();
                                            }}
                                            disable={isLoadingAccess}
                                        >
                                            {hasViewAccess ? t('accessDialog.revoke') : t('accessDialog.grant')}
                                        </MyButton>
                                    </div>

                                    {/* Edit access row */}
                                    <div className="flex items-center justify-between rounded-lg border border-neutral-200 p-3 hover:bg-neutral-50">
                                        <div className="flex items-center gap-3">
                                            <UserMinus className="size-5 text-warning-600" />
                                            <div>
                                                <p className="text-sm font-medium text-neutral-800">
                                                    {t('accessDialog.editAccessTitle')}
                                                </p>
                                                <p className="text-xs text-neutral-500">
                                                    {t('accessDialog.editAccessHint', {
                                                        term: getTerminology(
                                                            RoleTerms.Learner,
                                                            SystemTerms.Learner
                                                        ),
                                                    })}
                                                </p>
                                            </div>
                                        </div>
                                        <MyButton
                                            buttonType={hasEditAccess ? 'primary' : 'secondary'}
                                            scale="small"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleToggleEditAccess();
                                            }}
                                            disable={isLoadingAccess}
                                        >
                                            {hasEditAccess ? t('accessDialog.revoke') : t('accessDialog.grant')}
                                        </MyButton>
                                    </div>
                                </div>

                                {/* Help Text */}
                                <div className="rounded-lg bg-neutral-50 p-3 text-xs text-neutral-500">
                                    <p>{t('accessDialog.helpText')}</p>
                                </div>
                            </>
                        )}
                    </div>

                    <DialogFooter>
                        <MyButton
                            buttonType="secondary"
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowAccessDialog(false);
                                setEditingFile(null);
                            }}
                        >
                            {t('accessDialog.close')}
                        </MyButton>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};
