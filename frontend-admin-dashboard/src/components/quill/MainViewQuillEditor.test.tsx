// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@edtr-io/mathquill/build/mathquill.js', () => ({}));
vi.mock('mathquill4quill', () => ({ default: () => () => {} }));
vi.mock('@/services/upload_file', () => ({ UploadFileInS3: vi.fn(), getPublicUrl: vi.fn() }));
vi.mock('@/lib/auth/sessionUtility', () => ({
    getTokenDecodedData: () => null,
    getTokenFromCookie: () => null,
}));

import { MainViewQuillEditor } from './MainViewQuillEditor';

/**
 * react-quill 2.0.0 rebuilds the editor when `modules` changes and the rebuild leaves an
 * empty <pre> with no editor. The assessment preview re-renders right after it opens, so
 * its Question, Answer and Explanation editors all came up blank.
 */
describe('MainViewQuillEditor', () => {
    it('keeps its editor, with the value, across re-renders', async () => {
        const noop = () => {};
        const { container, rerender } = render(
            <MainViewQuillEditor value="<p>First</p>" onChange={noop} onBlur={noop} />
        );
        await waitFor(() => expect(container.querySelector('.ql-editor')).not.toBeNull());

        rerender(<MainViewQuillEditor value="<p>Is the lender a partner?</p>" onChange={noop} onBlur={noop} />);
        rerender(<MainViewQuillEditor value="<p>Is the lender a partner?</p>" onChange={noop} onBlur={noop} />);

        await waitFor(() =>
            expect(container.querySelector('.ql-editor')?.textContent).toContain('Is the lender a partner?')
        );
        expect(container.querySelector('.quill > pre:not(.ql-container)')).toBeNull();
    });
});
