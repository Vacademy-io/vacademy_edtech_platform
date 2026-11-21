import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDropzone } from 'react-dropzone';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    CheckCircle,
    CircleNotch,
    DownloadSimple,
    FileCsv,
    Info,
    UploadSimple,
    Warning,
    XCircle,
} from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { getPreferredPhoneCountries } from '@/services/domain-routing';
import type { TeamRoleOption } from '../-utils/team-helpers';
import {
    downloadRoleReference,
    downloadTeamImportResults,
    downloadTeamImportTemplate,
    isShareablePassword,
    parseTeamImportCsv,
    TEAM_IMPORT_HEADERS,
    type TeamImportParseResult,
    type TeamImportResult,
} from '../-utils/team-csv';
import { fetchAllTeamMembers, inviteTeamMember } from '../-services/team-member-services';
import { RoleChip } from './team-ui';

type Stage = 'select' | 'review' | 'running' | 'done';

interface TeamImportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    instituteId: string;
    roleOptions: TeamRoleOption[];
    /** Every role name the list queries match on (picker roles + legacy), for the duplicate check. */
    allRoleNames: string[];
}

const errorMessage = (error: unknown): string => {
    const data = (error as { response?: { data?: { ex?: string; message?: string } } })?.response
        ?.data;
    return data?.ex || data?.message || (error as Error)?.message || 'Request failed';
};

/**
 * Bulk invite from a CSV: pick a file → review what will happen (nothing is sent yet) →
 * invite the valid rows one by one → download a per-row report. Each row goes through the
 * same invite call as "Invite member", so each person gets the usual invite email.
 */
export function TeamImportDialog({
    open,
    onOpenChange,
    instituteId,
    roleOptions,
    allRoleNames,
}: TeamImportDialogProps) {
    const { t } = useTranslation('manageInstituteTeamsIndexLazy');
    const queryClient = useQueryClient();
    const defaultCountry = useMemo(() => getPreferredPhoneCountries().defaultCountry, []);
    const [stage, setStage] = useState<Stage>('select');
    const [fileName, setFileName] = useState<string | null>(null);
    const [parsing, setParsing] = useState(false);
    const [parsed, setParsed] = useState<TeamImportParseResult | null>(null);
    const [results, setResults] = useState<TeamImportResult[]>([]);
    const stopRequested = useRef(false);

    // Everyone already on the team (members + pending invites), to skip them before sending.
    const existingQuery = useQuery({
        queryKey: ['TEAM_EXISTING_EMAILS', instituteId, allRoleNames],
        queryFn: async () => {
            const { members } = await fetchAllTeamMembers(instituteId, {
                roles: allRoleNames,
                statuses: ['ACTIVE', 'DISABLED', 'INVITED'],
                name: '',
            });
            return new Set(
                members.map((m) => (m.email ?? '').trim().toLowerCase()).filter(Boolean)
            );
        },
        enabled: open && allRoleNames.length > 0,
        staleTime: 0,
    });

    const handleFile = async (file: File) => {
        if (!existingQuery.data) return;
        setFileName(file.name);
        setParsing(true);
        const result = await parseTeamImportCsv(
            file,
            { roleOptions, existingEmails: existingQuery.data, defaultCountry },
            t
        );
        setParsed(result);
        setParsing(false);
        setStage('review');
    };

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        accept: { 'text/csv': ['.csv'] },
        maxFiles: 1,
        multiple: false,
        disabled: parsing || !existingQuery.data,
        onDrop: (files) => {
            const file = files[0];
            if (file) void handleFile(file);
        },
    });

    const reset = () => {
        setStage('select');
        setFileName(null);
        setParsed(null);
        setResults([]);
        stopRequested.current = false;
    };

    const close = (next: boolean) => {
        if (!next && stage === 'running') return;
        if (!next) reset();
        onOpenChange(next);
    };

    const run = async () => {
        if (!parsed) return;
        stopRequested.current = false;
        setResults([]);
        setStage('running');
        const collected: TeamImportResult[] = [];
        for (const row of parsed.validRows) {
            if (stopRequested.current) break;
            try {
                const response = await inviteTeamMember(instituteId, {
                    name: row.name,
                    email: row.email,
                    mobileNumber: row.mobile || undefined,
                    roles: row.roles,
                });
                collected.push({
                    row,
                    success: true,
                    username: response?.username,
                    password: isShareablePassword(response?.password)
                        ? response?.password
                        : undefined,
                });
            } catch (error) {
                collected.push({ row, success: false, error: errorMessage(error) });
            }
            setResults([...collected]);
        }
        queryClient.invalidateQueries({ queryKey: ['TEAM_MEMBERS'] });
        queryClient.invalidateQueries({ queryKey: ['TEAM_COUNTS'] });
        queryClient.invalidateQueries({ queryKey: ['TEAM_EXISTING_EMAILS'] });
        setStage('done');
    };

    const labelOf = (name: string) => roleOptions.find((o) => o.name === name)?.label ?? name;
    const validCount = parsed?.validRows.length ?? 0;
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success);
    const stopped = stage === 'done' && results.length < validCount;

    const footer = (() => {
        if (stage === 'select') {
            return (
                <MyButton buttonType="secondary" onClick={() => close(false)}>
                    {t('common.cancel')}
                </MyButton>
            );
        }
        if (stage === 'review') {
            return (
                <>
                    <MyButton buttonType="secondary" onClick={reset}>
                        {t('import.chooseAnother')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        disable={validCount === 0}
                        onClick={() => void run()}
                    >
                        {t('import.send', { count: validCount })}
                    </MyButton>
                </>
            );
        }
        if (stage === 'running') {
            return (
                <MyButton
                    buttonType="secondary"
                    onClick={() => {
                        stopRequested.current = true;
                    }}
                >
                    {t('import.stop')}
                </MyButton>
            );
        }
        return (
            <>
                <MyButton
                    buttonType="secondary"
                    onClick={() => downloadTeamImportResults(results, roleOptions)}
                >
                    <DownloadSimple size={16} />
                    {t('import.downloadResults')}
                </MyButton>
                <MyButton buttonType="primary" onClick={() => close(false)}>
                    {t('import.done')}
                </MyButton>
            </>
        );
    })();

    return (
        <MyDialog
            open={open}
            onOpenChange={close}
            heading={t('import.heading')}
            dialogWidth="max-w-2xl"
            headerActions={
                <span className="flex size-8 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                    <UploadSimple size={18} />
                </span>
            }
            footer={footer}
        >
            {stage === 'select' && (
                <div className="flex flex-col gap-5">
                    <p className="text-body text-neutral-600">{t('import.intro')}</p>

                    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                        <div className="mb-2 text-body font-semibold text-neutral-900">
                            {t('import.formatTitle')}
                        </div>
                        <div className="mb-3 flex flex-wrap gap-1.5">
                            {TEAM_IMPORT_HEADERS.map((header) => (
                                <code
                                    key={header}
                                    className="rounded bg-white px-2 py-0.5 text-caption text-neutral-700 ring-1 ring-neutral-200"
                                >
                                    {header}
                                </code>
                            ))}
                        </div>
                        <ul className="mb-4 list-disc space-y-1 ps-5 text-caption text-neutral-600">
                            <li>{t('import.rules.required')}</li>
                            <li>{t('import.rules.roles')}</li>
                            <li>{t('import.rules.phone')}</li>
                            <li>{t('import.rules.teacher')}</li>
                        </ul>
                        <div className="flex flex-wrap gap-2">
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => downloadTeamImportTemplate(roleOptions)}
                            >
                                <FileCsv size={14} />
                                {t('import.template')}
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => downloadRoleReference(roleOptions)}
                            >
                                <DownloadSimple size={14} />
                                {t('import.roleReference')}
                            </MyButton>
                        </div>
                    </div>

                    <div
                        {...getRootProps()}
                        className={cn(
                            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 bg-white p-8 text-center transition-colors hover:border-primary-300',
                            isDragActive && 'border-primary-400 bg-primary-50',
                            (parsing || !existingQuery.data) && 'pointer-events-none opacity-60'
                        )}
                    >
                        <input {...getInputProps()} />
                        {parsing || existingQuery.isLoading ? (
                            <CircleNotch size={28} className="animate-spin text-neutral-400" />
                        ) : (
                            <UploadSimple size={28} className="text-primary-500" />
                        )}
                        <p className="text-body font-semibold text-neutral-800">
                            {existingQuery.isLoading
                                ? t('import.checkingTeam')
                                : fileName ?? t('import.dropHere')}
                        </p>
                        <p className="text-caption text-neutral-500">
                            {t('import.limit', { max: 500 })}
                        </p>
                    </div>
                    {existingQuery.isError && (
                        <p className="flex items-center gap-2 text-caption text-danger-600">
                            <Warning size={14} />
                            {t('import.teamLoadFailed')}
                        </p>
                    )}
                </div>
            )}

            {stage === 'review' && parsed && (
                <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-2 text-caption text-neutral-500">
                        <FileCsv size={16} />
                        {fileName}
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-lg border border-success-200 bg-success-50 p-3">
                            <div className="text-h3 font-bold text-success-700">{validCount}</div>
                            <div className="text-caption text-success-700">{t('import.ready')}</div>
                        </div>
                        <div className="rounded-lg border border-danger-200 bg-danger-50 p-3">
                            <div className="text-h3 font-bold text-danger-700">
                                {parsed.errors.length}
                            </div>
                            <div className="text-caption text-danger-700">
                                {t('import.skipped')}
                            </div>
                        </div>
                        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                            <div className="text-h3 font-bold text-neutral-800">
                                {parsed.totalCount}
                            </div>
                            <div className="text-caption text-neutral-600">
                                {t('import.totalRows')}
                            </div>
                        </div>
                    </div>

                    {parsed.errors.length > 0 && (
                        <div>
                            <div className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-neutral-500">
                                {t('import.skippedTitle')}
                            </div>
                            <ScrollArea className="max-h-44 rounded-lg border border-neutral-200">
                                <ul className="divide-y divide-neutral-100">
                                    {parsed.errors.map((error) => (
                                        <li
                                            key={`${error.rowNumber}-${error.label ?? ''}`}
                                            className="px-3 py-2"
                                        >
                                            <div className="text-caption font-semibold text-neutral-800">
                                                {error.rowNumber === 0
                                                    ? t('import.fileLevel')
                                                    : t('import.rowLabel', {
                                                          row: error.rowNumber,
                                                      })}
                                                {error.label ? ` · ${error.label}` : ''}
                                            </div>
                                            <ul className="ms-4 list-disc text-caption text-danger-600">
                                                {error.messages.map((message) => (
                                                    <li key={message}>{message}</li>
                                                ))}
                                            </ul>
                                        </li>
                                    ))}
                                </ul>
                            </ScrollArea>
                        </div>
                    )}

                    {validCount > 0 && (
                        <div>
                            <div className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-neutral-500">
                                {t('import.readyTitle')}
                            </div>
                            <ScrollArea className="max-h-52 rounded-lg border border-neutral-200">
                                <ul className="divide-y divide-neutral-100">
                                    {parsed.validRows.map((row) => (
                                        <li
                                            key={row.rowNumber}
                                            className="flex items-center gap-3 px-3 py-2"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-body font-semibold text-neutral-900">
                                                    {row.name}
                                                </div>
                                                <div className="truncate text-caption text-neutral-500">
                                                    {row.email}
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap justify-end gap-1">
                                                {row.roles.map((role) => (
                                                    <RoleChip
                                                        key={role}
                                                        name={role}
                                                        option={roleOptions.find(
                                                            (o) => o.name === role
                                                        )}
                                                    />
                                                ))}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </ScrollArea>
                        </div>
                    )}

                    {validCount > 0 && (
                        <div className="flex items-start gap-2.5 rounded-lg bg-info-50 px-3 py-2.5 text-caption text-info-700">
                            <Info size={16} className="mt-0.5 shrink-0" />
                            <span>{t('import.emailNote', { count: validCount })}</span>
                        </div>
                    )}
                </div>
            )}

            {(stage === 'running' || stage === 'done') && (
                <div className="flex flex-col gap-4">
                    {stage === 'running' ? (
                        <>
                            <div className="flex items-center gap-2 text-body text-neutral-700">
                                <CircleNotch size={18} className="animate-spin text-primary-500" />
                                {t('import.progress', { done: results.length, total: validCount })}
                            </div>
                            <Progress
                                value={validCount ? (results.length / validCount) * 100 : 0}
                            />
                            <p className="text-caption text-neutral-500">{t('import.keepOpen')}</p>
                        </>
                    ) : (
                        <div className="flex flex-col items-center py-2 text-center">
                            <div
                                className={cn(
                                    'mb-3 flex size-14 items-center justify-center rounded-full',
                                    failed.length === 0 && !stopped
                                        ? 'bg-success-50 text-success-600'
                                        : 'bg-warning-50 text-warning-700'
                                )}
                            >
                                {failed.length === 0 && !stopped ? (
                                    <CheckCircle size={30} weight="fill" />
                                ) : (
                                    <Warning size={30} weight="fill" />
                                )}
                            </div>
                            <h3 className="text-h3 font-semibold text-neutral-900">
                                {t('import.doneTitle', { count: succeeded })}
                            </h3>
                            <p className="mt-1 text-body text-neutral-500">
                                {stopped
                                    ? t('import.stoppedBody', {
                                          done: results.length,
                                          total: validCount,
                                      })
                                    : failed.length > 0
                                      ? t('import.failedBody', { count: failed.length })
                                      : t('import.doneBody')}
                            </p>
                        </div>
                    )}

                    {failed.length > 0 && (
                        <ScrollArea className="max-h-44 rounded-lg border border-neutral-200">
                            <ul className="divide-y divide-neutral-100">
                                {failed.map((result) => (
                                    <li
                                        key={result.row.rowNumber}
                                        className="flex items-start gap-2 px-3 py-2"
                                    >
                                        <XCircle
                                            size={16}
                                            className="mt-0.5 shrink-0 text-danger-600"
                                        />
                                        <div className="min-w-0">
                                            <div className="text-caption font-semibold text-neutral-800">
                                                {t('import.rowLabel', {
                                                    row: result.row.rowNumber,
                                                })}{' '}
                                                · {result.row.name} (
                                                {result.row.roles.map(labelOf).join(', ')})
                                            </div>
                                            <div className="text-caption text-danger-600">
                                                {result.error}
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </ScrollArea>
                    )}
                </div>
            )}
        </MyDialog>
    );
}
