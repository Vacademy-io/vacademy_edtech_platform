import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import {
    ArrowsClockwise,
    BookOpenText,
    LinkSimple,
    PencilSimple,
    Plus,
    Trash,
    WarningCircle,
} from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { MyButton } from '@/components/design-system/button';
import { ChipToggleGroup } from '@/components/design-system/chips';
import { MyDialog } from '@/components/design-system/dialog';
import { cn } from '@/lib/utils';
import { useKnowledgeBases } from '@/routes/knowledge-base/-hooks';
import { courseKnowledgeErrorDetail } from '@/services/course-knowledge-settings';
import { courseKnowledgeErrorMessage } from '@/services/course-knowledge';
import {
    COURSE_KB_DEFAULT_USE_IN,
    useCourseKbLinks,
    useRemoveCourseKbLink,
    useSaveCourseKbLink,
    type CourseKbGroundingMode,
    type CourseKbLegacyLink,
    type CourseKbLink,
    type CourseKbLinkProvenance,
    type CourseKbLinkRole,
    type CourseKbUseIn,
} from '@/services/course-knowledge-links';

const NAMESPACE = 'courseAiKnowledge';

const ROLES: CourseKbLinkRole[] = ['GROUNDING', 'REFERENCE'];
const MODES: CourseKbGroundingMode[] = ['STRICT', 'BLENDED'];
const USE_IN: CourseKbUseIn[] = ['tutor', 'chatbot'];

const PROVENANCE_TONE: Record<CourseKbLinkProvenance, string> = {
    AI_COURSE_CREATOR: 'border-primary-200 bg-primary-50 text-primary-500',
    ADMIN: 'border-neutral-200 bg-neutral-100 text-neutral-600',
    LEGACY_TUTOR_SETTING: 'border-warning-200 bg-warning-50 text-warning-700',
};

const Chip = ({ className, children }: { className?: string; children: React.ReactNode }) => (
    <span
        className={cn(
            'inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-caption font-medium',
            className ?? 'border-neutral-200 bg-white text-neutral-600'
        )}
    >
        {children}
    </span>
);

/** Readable message for a failed link write: the server's, else one per known code. */
const linkErrorMessage = (t: TFunction, error: unknown): string => {
    const detail = courseKnowledgeErrorDetail(error);
    if (detail?.reason === 'LIBRARY_LOCKED') return t('links.errors.locked');
    switch (detail?.code) {
        case 'kb_not_found':
            return t('links.errors.kbNotFound');
        case 'link_not_found':
            return t('links.errors.linkNotFound');
        case 'link_conflict':
            return t('links.errors.conflict');
        case 'links_not_enabled':
            return t('links.errors.notEnabled');
        default:
            return courseKnowledgeErrorMessage(error) ?? t('links.errors.save');
    }
};

interface LinkedKnowledgeCardProps {
    packageId: string;
}

type DialogState = { kind: 'add' } | { kind: 'edit'; link: CourseKbLink } | null;

/**
 * Course details → AI knowledge → Linked knowledge: the knowledge bases the
 * live tutor and the student AI use with this course. The AI course creator
 * adds one when it builds a course from a knowledge base; staff add, edit and
 * remove them here. A Tutor Mode KB grounding that predates links shows as a
 * read-only entry with a "Keep as link" action. Rendered only while the
 * platform's `links_enabled` flag is on.
 */
export const LinkedKnowledgeCard = ({ packageId }: LinkedKnowledgeCardProps) => {
    const { t } = useTranslation(NAMESPACE);
    const linksQuery = useCourseKbLinks(packageId);
    const saveLink = useSaveCourseKbLink(packageId);
    const [dialog, setDialog] = useState<DialogState>(null);
    const [removeTarget, setRemoveTarget] = useState<CourseKbLink | null>(null);

    const links = useMemo(() => linksQuery.data?.links ?? [], [linksQuery.data]);
    const legacy = linksQuery.data?.legacy ?? null;
    const linkedKbIds = useMemo(() => links.map((l) => l.knowledge_base_id), [links]);

    const keepLegacy = async (entry: CourseKbLegacyLink) => {
        try {
            await saveLink.mutateAsync({
                knowledge_base_id: entry.knowledge_base_id,
                role: 'GROUNDING',
                grounding_mode: entry.grounding_mode,
                // The note promises the student AI can use it once kept, so the
                // link gets the full default (tutor + chatbot), not the
                // tutor-only scope the legacy setting had.
                use_in: [...COURSE_KB_DEFAULT_USE_IN],
                provenance: 'LEGACY_TUTOR_SETTING',
            });
            toast.success(t('links.kept'));
        } catch (error) {
            toast.error(linkErrorMessage(t, error));
        }
    };

    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <BookOpenText className="size-5 text-primary-500" />
                    {t('links.title')}
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        className="ms-auto"
                        disable={linksQuery.isLoading || linksQuery.isError}
                        onClick={() => setDialog({ kind: 'add' })}
                    >
                        <Plus className="size-4" />
                        {t('links.add')}
                    </MyButton>
                </CardTitle>
                <p className="text-body text-neutral-500">{t('links.subtitle')}</p>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
                {linksQuery.isLoading ? (
                    <div className="flex flex-col gap-2" aria-busy="true">
                        <Skeleton className="h-16 w-full rounded-md" />
                        <Skeleton className="h-16 w-full rounded-md" />
                    </div>
                ) : linksQuery.isError ? (
                    <div className="flex flex-wrap items-center gap-2 text-body text-danger-600">
                        <WarningCircle className="size-4 shrink-0" />
                        {courseKnowledgeErrorMessage(linksQuery.error) ?? t('links.errors.load')}
                        <MyButton
                            buttonType="text"
                            scale="small"
                            onClick={() => void linksQuery.refetch()}
                        >
                            <ArrowsClockwise className="size-4" />
                            {t('errors.retry')}
                        </MyButton>
                    </div>
                ) : links.length === 0 && !legacy ? (
                    <p className="flex items-center gap-2 text-body text-neutral-500">
                        <LinkSimple className="size-4 shrink-0 text-neutral-400" />
                        {t('links.empty')}
                    </p>
                ) : (
                    <ul className="flex flex-col gap-2">
                        {links.map((link) => (
                            <LinkRow
                                key={link.id}
                                entry={link}
                                actions={
                                    <>
                                        <MyButton
                                            buttonType="text"
                                            scale="small"
                                            onClick={() => setDialog({ kind: 'edit', link })}
                                        >
                                            <PencilSimple className="size-4" />
                                            {t('links.edit')}
                                        </MyButton>
                                        <MyButton
                                            buttonType="text"
                                            scale="small"
                                            className="text-danger-600"
                                            onClick={() => setRemoveTarget(link)}
                                        >
                                            <Trash className="size-4" />
                                            {t('links.remove')}
                                        </MyButton>
                                    </>
                                }
                            />
                        ))}
                        {legacy && (
                            <LinkRow
                                entry={legacy}
                                note={t('links.legacyNote')}
                                actions={
                                    <MyButton
                                        buttonType="secondary"
                                        scale="small"
                                        onAsyncClick={() => keepLegacy(legacy)}
                                        loadingText={t('links.keeping')}
                                    >
                                        <LinkSimple className="size-4" />
                                        {t('links.keep')}
                                    </MyButton>
                                }
                            />
                        )}
                    </ul>
                )}
            </CardContent>

            {dialog && (
                <LinkDialog
                    packageId={packageId}
                    link={dialog.kind === 'edit' ? dialog.link : null}
                    linkedKbIds={linkedKbIds}
                    onClose={() => setDialog(null)}
                />
            )}

            <RemoveLinkDialog
                packageId={packageId}
                link={removeTarget}
                onClose={() => setRemoveTarget(null)}
            />
        </Card>
    );
};

interface LinkRowProps {
    entry: CourseKbLink | CourseKbLegacyLink;
    note?: string;
    actions: React.ReactNode;
}

const LinkRow = ({ entry, note, actions }: LinkRowProps) => {
    const { t, i18n } = useTranslation(NAMESPACE);
    const topicCount = entry.topic_node_ids.length;
    // Locale-aware list ("A and B", Arabic "A و B"); a bad locale tag falls back to commas.
    const usedBy = useMemo(() => {
        const names = entry.use_in.map((u) => t(`links.useIn.${u}`));
        try {
            return new Intl.ListFormat(i18n.language || 'en', {
                style: 'long',
                type: 'conjunction',
            }).format(names);
        } catch {
            return names.join(', ');
        }
    }, [entry.use_in, i18n.language, t]);
    const chapterCount = Object.keys(entry.chapter_topics ?? {}).length;

    return (
        <li className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="truncate text-subtitle font-semibold text-neutral-800">
                    {entry.knowledge_base_name || t('links.unnamed')}
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                    <Chip className={PROVENANCE_TONE[entry.provenance]}>
                        {t(`links.provenance.${entry.provenance}`)}
                    </Chip>
                    <Chip>{t(`links.roles.${entry.role}.label`)}</Chip>
                    <Chip>{t(`links.modes.${entry.grounding_mode}.label`)}</Chip>
                    <Chip>
                        {topicCount > 0
                            ? t('links.topics', { count: topicCount })
                            : t('links.allTopics')}
                    </Chip>
                    {chapterCount > 0 && (
                        <Chip>{t('links.chapters', { count: chapterCount })}</Chip>
                    )}
                    <span className="text-caption text-neutral-500">
                        {t('links.usedBy', { list: usedBy })}
                    </span>
                </div>
                {note && <p className="text-caption text-neutral-500">{note}</p>}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1">{actions}</div>
        </li>
    );
};

interface LinkDialogProps {
    packageId: string;
    /** The link being edited, or null to add one. */
    link: CourseKbLink | null;
    /** Knowledge bases already linked: not offered again when adding. */
    linkedKbIds: string[];
    onClose: () => void;
}

type LinkFormValues = {
    knowledge_base_id: string;
    role: CourseKbLinkRole;
    grounding_mode: CourseKbGroundingMode;
    use_in: CourseKbUseIn[];
};

const LinkDialog = ({ packageId, link, linkedKbIds, onClose }: LinkDialogProps) => {
    const { t } = useTranslation(NAMESPACE);
    const saveLink = useSaveCourseKbLink(packageId);
    // The same knowledge-base list the AI course creator's picker uses.
    const { data: bases, isLoading: basesLoading } = useKnowledgeBases();

    const schema = useMemo(
        () =>
            z.object({
                knowledge_base_id: z.string().min(1, t('links.form.kbRequired')),
                role: z.enum(['GROUNDING', 'REFERENCE']),
                grounding_mode: z.enum(['STRICT', 'BLENDED']),
                use_in: z.array(z.enum(['tutor', 'chatbot'])).min(1, t('links.form.useInRequired')),
            }),
        [t]
    );

    const form = useForm<LinkFormValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            knowledge_base_id: link?.knowledge_base_id ?? '',
            role: link?.role ?? 'GROUNDING',
            grounding_mode: link?.grounding_mode ?? 'STRICT',
            use_in: link?.use_in.length ? link.use_in : [...COURSE_KB_DEFAULT_USE_IN],
        },
    });

    const options = useMemo(
        () =>
            (bases ?? []).filter(
                (kb) => kb.id === link?.knowledge_base_id || !linkedKbIds.includes(kb.id)
            ),
        [bases, link, linkedKbIds]
    );

    const [saveError, setSaveError] = useState<string | null>(null);

    const roleOptions = ROLES.map((value) => ({
        value,
        label: t(`links.roles.${value}.label`),
    }));
    const modeOptions = MODES.map((value) => ({
        value,
        label: t(`links.modes.${value}.label`),
    }));
    const role = form.watch('role');
    const mode = form.watch('grounding_mode');

    const onSubmit = async (values: LinkFormValues) => {
        setSaveError(null);
        try {
            await saveLink.mutateAsync({
                knowledge_base_id: values.knowledge_base_id,
                role: values.role,
                grounding_mode: values.grounding_mode,
                use_in: values.use_in,
                provenance: 'ADMIN',
            });
            toast.success(link ? t('links.updated') : t('links.added'));
            onClose();
        } catch (error) {
            setSaveError(linkErrorMessage(t, error));
        }
    };

    const footer = (
        <div className="flex w-full flex-wrap justify-end gap-2">
            <MyButton buttonType="secondary" scale="medium" onClick={onClose}>
                {t('links.form.cancel')}
            </MyButton>
            <MyButton
                type="submit"
                form="course-kb-link-form"
                buttonType="primary"
                scale="medium"
                disable={saveLink.isPending ? true : undefined}
            >
                {saveLink.isPending ? t('links.form.saving') : t('links.form.save')}
            </MyButton>
        </div>
    );

    return (
        <MyDialog
            open
            onOpenChange={(open) => !open && onClose()}
            heading={link ? t('links.form.editTitle') : t('links.form.addTitle')}
            dialogWidth="max-w-lg"
            footer={footer}
        >
            <Form {...form}>
                <form
                    id="course-kb-link-form"
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="flex flex-col gap-4"
                >
                    <FormField
                        control={form.control}
                        name="knowledge_base_id"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('links.form.kb')}</FormLabel>
                                {basesLoading ? (
                                    <Skeleton className="h-9 w-full rounded-md" />
                                ) : link ? (
                                    <p className="text-body font-medium text-neutral-700">
                                        {link.knowledge_base_name || t('links.unnamed')}
                                    </p>
                                ) : options.length === 0 ? (
                                    <p className="text-body text-neutral-500">
                                        {t('links.form.noKbs')}
                                    </p>
                                ) : (
                                    <Select
                                        value={field.value}
                                        onValueChange={(next) => {
                                            setSaveError(null);
                                            field.onChange(next);
                                        }}
                                    >
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue
                                                    placeholder={t('links.form.kbPlaceholder')}
                                                />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {options.map((kb) => (
                                                <SelectItem key={kb.id} value={kb.id}>
                                                    {kb.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="role"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('links.form.role')}</FormLabel>
                                <ChipToggleGroup
                                    value={field.value}
                                    onChange={field.onChange}
                                    options={roleOptions}
                                    size="md"
                                    variant="outline"
                                    ariaLabel={t('links.form.role')}
                                />
                                <p className="text-caption text-neutral-500">
                                    {t(`links.roles.${role}.help`)}
                                </p>
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="grounding_mode"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('links.form.mode')}</FormLabel>
                                <ChipToggleGroup
                                    value={field.value}
                                    onChange={field.onChange}
                                    options={modeOptions}
                                    size="md"
                                    variant="outline"
                                    ariaLabel={t('links.form.mode')}
                                />
                                <p className="text-caption text-neutral-500">
                                    {t(`links.modes.${mode}.help`)}
                                </p>
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="use_in"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('links.form.useIn')}</FormLabel>
                                <div className="flex flex-wrap gap-4">
                                    {USE_IN.map((value) => {
                                        const id = `course-kb-link-use-in-${value}`;
                                        const checked = field.value.includes(value);
                                        return (
                                            <label
                                                key={value}
                                                htmlFor={id}
                                                className="flex cursor-pointer items-center gap-2 text-body text-neutral-700"
                                            >
                                                <Checkbox
                                                    id={id}
                                                    checked={checked}
                                                    onCheckedChange={(next) =>
                                                        field.onChange(
                                                            next === true
                                                                ? USE_IN.filter(
                                                                      (u) =>
                                                                          u === value ||
                                                                          field.value.includes(u)
                                                                  )
                                                                : field.value.filter(
                                                                      (u) => u !== value
                                                                  )
                                                        )
                                                    }
                                                />
                                                {t(`links.useIn.${value}`)}
                                            </label>
                                        );
                                    })}
                                </div>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    {saveError && (
                        <p className="flex items-center gap-2 text-body text-danger-600">
                            <WarningCircle className="size-4 shrink-0" />
                            {saveError}
                        </p>
                    )}
                </form>
            </Form>
        </MyDialog>
    );
};

interface RemoveLinkDialogProps {
    packageId: string;
    link: CourseKbLink | null;
    onClose: () => void;
}

const RemoveLinkDialog = ({ packageId, link, onClose }: RemoveLinkDialogProps) => {
    const { t } = useTranslation(NAMESPACE);
    const removeLink = useRemoveCourseKbLink(packageId);

    const remove = async () => {
        if (!link) return;
        try {
            await removeLink.mutateAsync(link.id);
            toast.success(t('links.removed'));
            onClose();
        } catch (error) {
            toast.error(linkErrorMessage(t, error));
        }
    };

    return (
        <MyDialog
            open={link !== null}
            onOpenChange={(open) => !open && onClose()}
            heading={t('links.removeTitle')}
            dialogWidth="max-w-md"
            footer={
                <div className="flex w-full flex-wrap justify-end gap-2">
                    <MyButton buttonType="secondary" scale="medium" onClick={onClose}>
                        {t('links.form.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onAsyncClick={remove}
                        loadingText={t('links.removing')}
                    >
                        <Trash className="size-4" />
                        {t('links.remove')}
                    </MyButton>
                </div>
            }
        >
            <p className="text-body text-neutral-700">
                {t('links.removeBody', {
                    name: link?.knowledge_base_name || t('links.unnamed'),
                })}
            </p>
        </MyDialog>
    );
};
