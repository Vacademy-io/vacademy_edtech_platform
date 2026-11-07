import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { BookOpenText, Exam, GraduationCap } from '@phosphor-icons/react';
import { Card } from '@/components/ui/card';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import type { KnowledgeBase } from '../../-types';
import { boardsOf, classLabel, classesOf } from './curriculum';

interface CurriculumBrowserProps {
    /** Curriculum knowledge bases only (see curriculumOnly). */
    knowledgeBases: KnowledgeBase[];
}

const formatCount = (n: number) => new Intl.NumberFormat('en-IN').format(n);

/**
 * The Curriculum tab: pick a class, see its books.
 *
 * Each book card opens the ordinary knowledge-base page (Ask, "What it
 * covers", Create question paper, Create course all work there — the base is
 * read-only for the institute). Two shortcuts sit on the card because they
 * are what people come here for.
 */
export const CurriculumBrowser = ({ knowledgeBases }: CurriculumBrowserProps) => {
    const { t } = useTranslation('knowledgeBaseCurriculum');
    const navigate = useNavigate();

    const boards = useMemo(() => boardsOf(knowledgeBases), [knowledgeBases]);
    const [board, setBoard] = useState<string>(boards[0] ?? '');
    useEffect(() => {
        if (!board || !boards.includes(board)) setBoard(boards[0] ?? '');
    }, [board, boards]);

    const classes = useMemo(
        () => (board ? classesOf(knowledgeBases, board) : []),
        [knowledgeBases, board]
    );
    const [cls, setCls] = useState<string>('');
    useEffect(() => {
        if (!cls || !classes.includes(cls)) setCls(classes[0] ?? '');
    }, [cls, classes]);

    const books = useMemo(
        () =>
            knowledgeBases
                .filter((kb) => kb.curriculum!.board === board && kb.curriculum!.class === cls)
                .sort((a, b) =>
                    `${a.curriculum!.subject} ${a.curriculum!.book ?? ''}`.localeCompare(
                        `${b.curriculum!.subject} ${b.curriculum!.book ?? ''}`
                    )
                ),
        [knowledgeBases, board, cls]
    );

    const chip = (active: boolean) =>
        cn(
            'rounded-full border px-3 py-1 text-caption transition-colors',
            active
                ? 'border-primary-500 bg-primary-50 text-primary-600'
                : 'border-neutral-200 text-neutral-600 hover:border-primary-300'
        );

    return (
        <div className="flex flex-col gap-5">
            <div>
                <p className="text-title font-semibold text-neutral-700">{t('browser.heading')}</p>
                <p className="mt-1 max-w-2xl text-body text-neutral-500">
                    {t('browser.description')}
                </p>
            </div>

            {boards.length > 1 && (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-caption text-neutral-500">{t('board')}</span>
                    {boards.map((b) => (
                        <button
                            key={b}
                            type="button"
                            className={chip(b === board)}
                            onClick={() => setBoard(b)}
                        >
                            {b}
                        </button>
                    ))}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
                <span className="text-caption text-neutral-500">{t('class')}</span>
                {classes.map((c) => (
                    <button
                        key={c}
                        type="button"
                        className={chip(c === cls)}
                        onClick={() => setCls(c)}
                    >
                        {classLabel(c, t)}
                    </button>
                ))}
            </div>

            {books.length === 0 && (
                <Card className="flex flex-col items-center gap-2 p-8 text-center">
                    <BookOpenText className="size-6 text-neutral-300" />
                    <p className="text-body text-neutral-600">{t('browser.empty')}</p>
                </Card>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {books.map((kb) => {
                    const open = () =>
                        navigate({ to: '/knowledge-base/$kbId', params: { kbId: kb.id } });
                    const chapters = kb.stats?.sources ?? kb.source_count ?? 0;
                    return (
                        <Card
                            key={kb.id}
                            role="button"
                            tabIndex={0}
                            onClick={open}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    open();
                                }
                            }}
                            className="flex cursor-pointer flex-col gap-3 p-4 transition-colors hover:border-primary-200"
                        >
                            <div className="flex items-start gap-3">
                                <div className="rounded-lg bg-primary-50 p-2">
                                    <BookOpenText className="size-5 text-primary-500" />
                                </div>
                                <div className="min-w-0">
                                    <p className="truncate text-subtitle font-semibold text-neutral-700">
                                        {kb.curriculum!.subject}
                                    </p>
                                    <p className="truncate text-caption text-neutral-500">
                                        {kb.curriculum!.book &&
                                        kb.curriculum!.book !==
                                            `Class ${cls} ${kb.curriculum!.subject}`
                                            ? kb.curriculum!.book
                                            : `${kb.curriculum!.board} · ${classLabel(cls, t)}`}
                                        {kb.curriculum!.medium ? ` · ${kb.curriculum!.medium}` : ''}
                                    </p>
                                </div>
                            </div>
                            <p className="text-caption text-neutral-500">
                                {t('chapters', { count: chapters })}
                                {kb.stats?.pages
                                    ? ` · ${t('pages', { count: kb.stats.pages, formatted: formatCount(kb.stats.pages) })}`
                                    : ''}
                            </p>
                            <div className="mt-auto flex flex-wrap gap-2">
                                <MyButton
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        navigate({
                                            to: '/knowledge-base/paper/$kbId',
                                            params: { kbId: kb.id },
                                        });
                                    }}
                                >
                                    <Exam className="mr-1 size-4" />
                                    {t('browser.createPaper')}
                                </MyButton>
                                <MyButton
                                    buttonType="text"
                                    scale="small"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        navigate({
                                            to: '/study-library/ai-copilot',
                                            search: { kb: kb.id },
                                        });
                                    }}
                                >
                                    <GraduationCap className="mr-1 size-4" />
                                    {t('browser.createCourse')}
                                </MyButton>
                            </div>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
};
