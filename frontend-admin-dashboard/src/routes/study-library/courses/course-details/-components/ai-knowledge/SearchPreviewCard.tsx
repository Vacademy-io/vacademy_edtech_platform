import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { FileText, Info, MagnifyingGlass, PlayCircle, WarningCircle } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import {
    courseKnowledgeErrorMessage,
    coursePreviewMaxChars,
    usePreviewCourseSearch,
    type CoursePreviewHit,
} from '@/services/course-knowledge';

const NAMESPACE = 'courseAiKnowledge';

type FormValues = { query: string };

/** 271 s → "04:31"; an hour or more → "1:02:05". */
const clock = (ms: number) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return hours > 0
        ? `${hours}:${pad(minutes)}:${pad(seconds)}`
        : `${pad(minutes)}:${pad(seconds)}`;
};

interface SearchPreviewCardProps {
    packageId: string;
}

/**
 * "Test what the AI finds": runs the learner retrieval over every published
 * lesson of the course (drip ignored) and shows the passages it would use.
 * No LLM call and no credits.
 */
export const SearchPreviewCard = ({ packageId }: SearchPreviewCardProps) => {
    const { t } = useTranslation(NAMESPACE);
    const preview = usePreviewCourseSearch(packageId);

    const schema = useMemo(
        () =>
            z.object({
                query: z
                    .string()
                    .trim()
                    .min(1, t('search.required'))
                    .max(
                        coursePreviewMaxChars,
                        t('search.tooLong', { max: coursePreviewMaxChars })
                    ),
            }),
        [t]
    );

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: { query: '' },
    });

    const onSubmit = async (values: FormValues) => {
        try {
            await preview.mutateAsync(values.query.trim());
        } catch {
            // Shown below from preview.error.
        }
    };

    const result = preview.data;

    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                    <MagnifyingGlass className="size-5 text-primary-500" />
                    {t('search.title')}
                </CardTitle>
                <p className="flex items-center gap-1.5 text-caption text-neutral-500">
                    <Info className="size-3.5 shrink-0" />
                    {t('search.note')}
                </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                <Form {...form}>
                    <form
                        onSubmit={form.handleSubmit(onSubmit)}
                        className="flex flex-col gap-2 sm:flex-row sm:items-end"
                    >
                        <FormField
                            control={form.control}
                            name="query"
                            render={({ field }) => (
                                <FormItem className="flex-1">
                                    <FormControl>
                                        <MyInput
                                            label={t('search.label')}
                                            inputType="text"
                                            size="medium"
                                            className="sm:w-full"
                                            inputPlaceholder={t('search.placeholder')}
                                            input={field.value}
                                            onChangeFunction={field.onChange}
                                            onBlur={field.onBlur}
                                            name={field.name}
                                            ref={field.ref}
                                            maxLength={coursePreviewMaxChars}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <MyButton
                            type="submit"
                            buttonType="secondary"
                            scale="medium"
                            disable={preview.isPending ? true : undefined}
                        >
                            <MagnifyingGlass className="size-4" />
                            {preview.isPending ? t('search.searching') : t('search.submit')}
                        </MyButton>
                    </form>
                </Form>

                {preview.isPending ? (
                    <div className="flex flex-col gap-2" aria-busy="true">
                        <Skeleton className="h-16 w-full rounded-md" />
                        <Skeleton className="h-16 w-full rounded-md" />
                    </div>
                ) : preview.isError ? (
                    <p className="flex items-center gap-2 text-body text-danger-600">
                        <WarningCircle className="size-4 shrink-0" />
                        {courseKnowledgeErrorMessage(preview.error) ?? t('search.error')}
                    </p>
                ) : result ? (
                    result.hits.length === 0 ? (
                        <p className="rounded-md border border-neutral-200 bg-neutral-50 p-4 text-center text-body text-neutral-500">
                            {t('search.empty')}
                        </p>
                    ) : (
                        <div className="flex flex-col gap-2">
                            <p className="text-caption text-neutral-500">
                                {t('search.results', { count: result.hits.length })}
                            </p>
                            <ul className="flex flex-col gap-2">
                                {result.hits.map((hit, index) => (
                                    <PreviewHitRow key={`${hit.slide_id}-${index}`} hit={hit} />
                                ))}
                            </ul>
                        </div>
                    )
                ) : null}
            </CardContent>
        </Card>
    );
};

const PreviewHitRow = ({ hit }: { hit: CoursePreviewHit }) => {
    const { t } = useTranslation(NAMESPACE);
    const badge =
        hit.page && hit.page > 0
            ? t('search.page', { page: hit.page })
            : hit.t_start_ms && hit.t_start_ms > 0
              ? clock(hit.t_start_ms)
              : null;
    const Icon = hit.t_start_ms && hit.t_start_ms > 0 ? PlayCircle : FileText;

    return (
        <li className="flex flex-col gap-1 rounded-md border border-neutral-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
                <Icon className="size-4 shrink-0 text-primary-500" />
                <span className="text-body font-medium text-neutral-800">
                    {hit.title || t('search.untitled')}
                </span>
                {hit.chapter_name && (
                    <span className="text-caption text-neutral-500">· {hit.chapter_name}</span>
                )}
                {badge && (
                    <span className="ms-auto rounded-md border border-primary-100 bg-primary-50 px-2 py-0.5 text-caption font-medium text-primary-500">
                        {badge}
                    </span>
                )}
            </div>
            <p className="line-clamp-3 text-caption text-neutral-600">{hit.excerpt}</p>
        </li>
    );
};
