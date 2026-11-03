import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AiCheckMenu, ExportMenu } from '../SubmissionsActionMenus';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

// Radix opens a DropdownMenu on keyboard as well as pointer; keyboard is what
// happy-dom handles reliably.
const openMenu = (triggerLabel: string) => {
    const trigger = screen.getByRole('button', { name: new RegExp(triggerLabel) });
    fireEvent.keyDown(trigger, { key: 'Enter' });
};

const aiHandlers = () => ({
    onCheckSubmitted: vi.fn(),
    onUploadCopies: vi.fn(),
    onToggleProgress: vi.fn(),
    onOpenResults: vi.fn(),
});

describe('AiCheckMenu', () => {
    it.each([
        ['actionMenus.ai.checkSubmitted.title', 'onCheckSubmitted'],
        ['actionMenus.ai.upload.title', 'onUploadCopies'],
        ['actionMenus.ai.progress.title', 'onToggleProgress'],
        ['actionMenus.ai.results.title', 'onOpenResults'],
    ] as const)('"%s" runs %s and nothing else', (label, handler) => {
        const handlers = aiHandlers();
        render(<AiCheckMenu {...handlers} isProgressOpen={false} />);
        openMenu('actionMenus.ai.trigger');
        fireEvent.click(screen.getByText(label));
        for (const [name, fn] of Object.entries(handlers)) {
            expect(fn).toHaveBeenCalledTimes(name === handler ? 1 : 0);
        }
    });

    it('says "hide" for the progress panel once it is open', () => {
        render(<AiCheckMenu {...aiHandlers()} isProgressOpen />);
        openMenu('actionMenus.ai.trigger');
        expect(screen.getByText('actionMenus.ai.progress.hideTitle')).toBeTruthy();
    });
});

describe('ExportMenu', () => {
    const handlers = () => ({
        onExportCsv: vi.fn(),
        onExportZip: vi.fn(),
        onAiReport: vi.fn(),
    });

    it('offers CSV, report cards and the AI report on Attempted', () => {
        const h = handlers();
        render(<ExportMenu {...h} />);
        openMenu('actionMenus.export.trigger');
        fireEvent.click(screen.getByText('actionMenus.export.zip.title'));
        expect(h.onExportZip).toHaveBeenCalledTimes(1);
        expect(h.onExportCsv).not.toHaveBeenCalled();
    });

    it('on Pending: learner-list CSV, no report cards', () => {
        const h = handlers();
        render(<ExportMenu {...h} isPendingList showReportCards={false} />);
        openMenu('actionMenus.export.trigger');
        expect(screen.queryByText('actionMenus.export.zip.title')).toBeNull();
        fireEvent.click(screen.getByText('actionMenus.export.csvPending.title'));
        expect(h.onExportCsv).toHaveBeenCalledTimes(1);
    });
});
