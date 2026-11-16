import React, { Suspense, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FilePdf } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { getPublicUrl } from '@/services/upload_file';
import { AddDocumentQuizDialog } from './add-document-quiz-dialog';
import type { DocumentQuizRef } from './document-quiz-ref';

const PDFViewer = React.lazy(() => import('../pdf-viewer'));

interface DocumentQuizPreviewProps {
    documentRef: DocumentQuizRef;
    /** The ordinary quiz editor (QuizPreview), shown beside the document. */
    children: ReactNode;
}

/**
 * Admin view of a Document + Quiz slide: the PDF learners will read on the left,
 * the usual quiz editor on the right. Stacks on narrow screens.
 */
export const DocumentQuizPreview = ({ documentRef, children }: DocumentQuizPreviewProps) => {
    const { t } = useTranslation('studyLibraryDocumentQuiz');
    const [url, setUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const [replaceOpen, setReplaceOpen] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setUrl(null);
        setFailed(false);
        getPublicUrl(documentRef.fileId)
            .then((resolved) => {
                if (cancelled) return;
                if (resolved) setUrl(resolved);
                else setFailed(true);
            })
            .catch(() => {
                if (!cancelled) setFailed(true);
            });
        return () => {
            cancelled = true;
        };
    }, [documentRef.fileId]);

    return (
        <div className="flex size-full min-h-0 flex-col gap-3 md:flex-row">
            <section
                aria-label={t('preview.documentHeading')}
                className="flex h-96 min-h-0 flex-col overflow-hidden rounded border border-neutral-200 bg-white md:h-full md:w-1/2"
            >
                <header className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2">
                    <FilePdf className="size-4 shrink-0 text-primary-500" />
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-neutral-700">
                            {documentRef.fileName || t('preview.documentHeading')}
                        </p>
                        <p className="truncate text-xs text-neutral-500">{t('preview.hint')}</p>
                    </div>
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        type="button"
                        onClick={() => setReplaceOpen(true)}
                    >
                        {t('preview.replace')}
                    </MyButton>
                </header>
                <div className="min-h-0 flex-1 overflow-auto">
                    {url ? (
                        <Suspense
                            fallback={<div className="size-full animate-pulse bg-neutral-100" />}
                        >
                            <PDFViewer pdfUrl={url} />
                        </Suspense>
                    ) : (
                        <div className="flex size-full items-center justify-center p-4 text-sm text-neutral-500">
                            {failed ? t('preview.loadFailed') : t('preview.loading')}
                        </div>
                    )}
                </div>
            </section>
            <section className="min-h-0 flex-1 overflow-auto md:w-1/2">{children}</section>

            <MyDialog
                trigger={<></>}
                heading={t('dialog.replaceHeading')}
                dialogWidth="min-w-slide-dialog-sm w-auto"
                open={replaceOpen}
                onOpenChange={setReplaceOpen}
            >
                <AddDocumentQuizDialog mode="replace" onDone={() => setReplaceOpen(false)} />
            </MyDialog>
        </div>
    );
};
