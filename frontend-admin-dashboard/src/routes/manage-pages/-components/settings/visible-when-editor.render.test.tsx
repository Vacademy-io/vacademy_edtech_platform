import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { VisibleWhenEditor } from './VisibleWhenEditor';

/**
 * The one-click "Show on" preset checks ?stream only: the section shows on the
 * Courses page's All courses tab and hides once a stream tab is picked, even
 * while the visitor filters inside All courses. Its label says exactly that.
 */

describe('VisibleWhenEditor preset', () => {
    it('names the All courses tab, and writes the ?stream-is-empty rule', () => {
        const onChange = vi.fn();
        render(<VisibleWhenEditor rules={undefined} onChange={onChange} idPrefix="start-free" />);
        expect(screen.getByText('Always shown')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Show on/ }));
        expect(screen.getByText(/keep “Start free” on the All courses tab and hide it once a stream tab is picked/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Only on the All courses tab' }));
        expect(onChange).toHaveBeenCalledWith([{ param: 'stream', op: 'empty' }]);
        expect(screen.queryByText(/unfiltered/i)).not.toBeInTheDocument();
    });

    it('sums up a section that already uses the preset', () => {
        render(
            <VisibleWhenEditor rules={[{ param: 'stream', op: 'empty' }]} onChange={vi.fn()} idPrefix="start-free" />
        );
        expect(screen.getByRole('button', { name: /Show on Only on the All courses tab/ })).toBeInTheDocument();
    });
});
