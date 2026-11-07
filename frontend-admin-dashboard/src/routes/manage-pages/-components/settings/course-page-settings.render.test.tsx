import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CoursePageSettingsCard } from './CoursePageSettingsCard';

/** Global Settings → Course page: parts of the public course page, on unless stored false. */
describe('CoursePageSettingsCard', () => {
    const switches = () => screen.getAllByRole('switch');

    it('shows every part on when nothing is stored', () => {
        render(<CoursePageSettingsCard value={undefined} onChange={vi.fn()} />);
        expect(switches().map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'true', 'true']);
    });

    it('stores false to hide Course content and keeps the other courseDetails keys', () => {
        const onChange = vi.fn();
        render(<CoursePageSettingsCard value={{ layout: 'standard', appBanner: false }} onChange={onChange} />);
        fireEvent.click(switches()[0]!);
        expect(onChange).toHaveBeenCalledWith({ layout: 'standard', appBanner: false, content: false });
    });

    it('stores false to hide only the Course content heading', () => {
        const onChange = vi.fn();
        render(<CoursePageSettingsCard value={{ series: false }} onChange={onChange} />);
        fireEvent.click(switches()[1]!);
        expect(onChange).toHaveBeenCalledWith({ series: false, contentHeading: false });
    });

    it('drops the key again when switched back on', () => {
        const onChange = vi.fn();
        render(<CoursePageSettingsCard value={{ content: false, series: false, layout: 'standard' }} onChange={onChange} />);
        expect(switches().map((s) => s.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
        fireEvent.click(switches()[2]!);
        expect(onChange).toHaveBeenCalledWith({ content: false, layout: 'standard' });
    });

    it('stores seriesLimit as a number and drops it when emptied', () => {
        const onChange = vi.fn();
        render(<CoursePageSettingsCard value={{ series: true, layout: 'standard' }} onChange={onChange} />);
        const input = screen.getByLabelText('global.coursePage.seriesLimit');
        fireEvent.change(input, { target: { value: '3' } });
        expect(onChange).toHaveBeenLastCalledWith({ series: true, layout: 'standard', seriesLimit: 3 });
        fireEvent.change(input, { target: { value: '' } });
        expect(onChange).toHaveBeenLastCalledWith({ series: true, layout: 'standard' });
        fireEvent.change(input, { target: { value: '0' } });
        expect(onChange).toHaveBeenLastCalledWith({ series: true, layout: 'standard' });
    });

    it('shows the stored limit, and no limit field while the chips are off', () => {
        const { unmount } = render(
            <CoursePageSettingsCard value={{ seriesLimit: 3 }} onChange={vi.fn()} />
        );
        expect(screen.getByLabelText('global.coursePage.seriesLimit')).toHaveValue('3');
        unmount();
        render(<CoursePageSettingsCard value={{ series: false }} onChange={vi.fn()} />);
        expect(screen.queryByLabelText('global.coursePage.seriesLimit')).toBeNull();
    });
});
