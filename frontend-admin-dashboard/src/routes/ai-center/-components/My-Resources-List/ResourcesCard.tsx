import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'; // Adjust path based on your project structure
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'; // Adjust path
import { Badge } from '@/components/ui/badge'; // Adjust path
import { Button } from '@/components/ui/button'; // Adjust path
import { DownloadSimple } from '@phosphor-icons/react'; // Added MoreVertical and Eye icons
import { AIFormatDate, getAIIconByMimeType } from '../../-utils/helper';
import ExtractQuestionsComponent from './ExtractQuestionsComponent';
import TopicWiseQuestionsComponent from './TopicWiseQuestionsComponent';
import GenerateQuestionsFromAudio from './GenerateQuestionsFromAudio';
import EvaluateLectureComponent from './EvaluateLectureComponent';
import GenerateQuestionsComponent from './GenerateQuestionsComponent';

// --- Type Definitions ---
interface FileDetail {
    id: string;
    url: string;
    file_name: string;
    file_type: string;
    created_on: string; // ISO date string
    // Optional fields from API, present in the example:
    source?: string;
    source_id?: string;
    expiry?: string;
    width?: number;
    height?: number;
    updated_on?: string;
}
interface TaskStatus {
    id: string; // ID of the task status object
    // Other task-specific fields from API example
    task_name?: string;
    institute_id?: string;
    status?: string;
    result_json?: string; // Can be a complex JSON string
    input_id?: string;
    input_type?: string;
    created_at?: string; // Task creation/update time
    updated_at?: string; // Task creation/update time
    parent_id?: string | null;
    file_detail: FileDetail | null; // The file associated with this task status
}
interface ResourceFilesPageProps {
    apiResponse: TaskStatus[]; // The array of task status objects from your API
}

// --- React Component ---
export function ResourcesCard({ apiResponse }: ResourceFilesPageProps) {
    const { t } = useTranslation('aiCenterResourcesCard');
    const { t: tHelper } = useTranslation('aiCenterHelper');
    const processedFiles = useMemo(() => {
        const uniqueFilesMap = new Map<string, TaskStatus>();
        apiResponse.forEach((task) => {
            // Ensure task and file_detail exist and have a valid id and other critical fields
            if (
                task &&
                task.file_detail &&
                task.file_detail.id &&
                task.file_detail.url &&
                task.file_detail.created_on
            ) {
                if (!uniqueFilesMap.has(task.id)) {
                    uniqueFilesMap.set(task.id, task);
                }
            }
        });
        const uniqueFilesArray = Array.from(uniqueFilesMap.values());
        // Sort by file_detail.created_on in descending order
        uniqueFilesArray.sort((fileA, fileB) => {
            const dateA = fileA.file_detail?.created_on
                ? new Date(fileA.file_detail.created_on).getTime()
                : 0;
            const dateB = fileB.file_detail?.created_on
                ? new Date(fileB.file_detail.created_on).getTime()
                : 0;
            if (isNaN(dateA) && isNaN(dateB)) return 0;
            if (isNaN(dateA)) return 1; // Put invalid dates last or first
            if (isNaN(dateB)) return -1;
            return dateB - dateA;
        });
        return uniqueFilesArray;
    }, [apiResponse]);

    if (!apiResponse || apiResponse.length === 0) {
        return (
            <Card className="mx-auto my-8 w-full max-w-4xl shadow-lg">
                <CardHeader>
                    <CardTitle>{t('emptyState.title')}</CardTitle>
                    <CardDescription>{t('emptyState.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="py-10 text-center">
                        <svg
                            className="mx-auto size-12 text-gray-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            aria-hidden="true"
                        >
                            <path
                                vectorEffect="non-scaling-stroke"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
                            />
                        </svg>
                        <h3 className="mt-2 text-lg font-medium text-gray-900">
                            {t('emptyState.heading')}
                        </h3>
                        <p className="mt-1 text-sm text-gray-500">{t('emptyState.body')}</p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="mx-auto my-8 w-full shadow-lg">
            <CardHeader>
                <CardTitle>{t('title')}</CardTitle>
                <CardDescription>{t('description')}</CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-1/3">{t('table.fileName')}</TableHead>
                            <TableHead className="w-1/5">{t('table.type')}</TableHead>
                            <TableHead className="w-1/4 text-center">
                                {t('table.createdOn')}
                            </TableHead>
                            <TableHead className="w-1/5 text-center">
                                {t('table.actions')}
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {processedFiles?.map((file) => (
                            <TableRow key={file.file_detail?.id}>
                                <TableCell className="font-medium">
                                    <div className="flex flex-col items-start">
                                        <span
                                            className="truncate"
                                            title={file.file_detail?.file_name}
                                        >
                                            {file.file_detail?.file_name}
                                        </span>
                                        <div className="my-2 flex items-center gap-4">
                                            {file.file_detail?.file_type
                                                .toLowerCase()
                                                .includes('pdf') ||
                                            file.file_detail?.file_type
                                                .toLowerCase()
                                                .includes('document') ? (
                                                <>
                                                    <GenerateQuestionsComponent
                                                        fileId={file.input_id || ''}
                                                    />

                                                    <ExtractQuestionsComponent
                                                        fileId={file.input_id || ''}
                                                    />

                                                    <TopicWiseQuestionsComponent
                                                        fileId={file.input_id || ''}
                                                    />
                                                </>
                                            ) : (
                                                <>
                                                    <GenerateQuestionsFromAudio
                                                        fileId={file.input_id || ''}
                                                    />

                                                    <EvaluateLectureComponent
                                                        fileId={file.input_id || ''}
                                                    />
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Badge className="whitespace-nowrap border-none shadow-none">
                                        {(() => {
                                            const IconComponent = getAIIconByMimeType(
                                                file.file_detail?.file_type || ''
                                            );
                                            return <IconComponent size={20} />;
                                        })()}
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-right text-sm text-gray-600">
                                    {AIFormatDate(file.file_detail?.created_on || '', tHelper)}
                                </TableCell>
                                <TableCell className="text-center">
                                    <div className="flex items-center justify-center space-x-1">
                                        {file.file_detail?.url ? (
                                            <>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    asChild
                                                    title={t('actions.download', {
                                                        fileName: file.file_detail.file_name,
                                                    })}
                                                >
                                                    <a
                                                        href={file.file_detail.url}
                                                        download={file.file_detail.file_name} // Suggests browser to download with this name
                                                        rel="noopener noreferrer"
                                                        aria-label={t('actions.download', {
                                                            fileName: file.file_detail.file_name,
                                                        })}
                                                    >
                                                        <DownloadSimple className="size-4 text-gray-700 hover:text-gray-900" />
                                                    </a>
                                                </Button>
                                            </>
                                        ) : (
                                            <span className="text-xs text-gray-400">
                                                {t('actions.noFile')}
                                            </span>
                                        )}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
export default ResourcesCard;
