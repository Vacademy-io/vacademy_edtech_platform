import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { uploadFile, readImageSize, prepareOriginal, prepareCropped, cropper } = vi.hoisted(() => ({
    uploadFile: vi.fn(),
    readImageSize: vi.fn(),
    prepareOriginal: vi.fn(),
    prepareCropped: vi.fn(),
    cropper: { last: null as null | Record<string, any> },
}));

vi.mock('@/hooks/use-file-upload', () => ({ useFileUpload: () => ({ uploadFile }) }));
vi.mock('@/services/upload_file', () => ({ getPublicUrl: async (id: string) => `https://cdn/${id}` }));
vi.mock('@/utils/userDetails', () => ({ getUserId: () => 'u-1' }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../-services/ai-page-service', () => ({ generateAiImage: vi.fn() }));
vi.mock('./MediaLibraryDialog', () => ({ MediaLibraryDialog: () => null }));
vi.mock('../-utils/image-prep', () => ({ readImageSize, prepareOriginal, prepareCropped }));
// The cropper as a record of what it was opened with, and two buttons.
vi.mock('@/components/design-system/image-cropper-dialog', () => ({
    default: (props: Record<string, any>) => {
        cropper.last = props;
        return (
            <div data-testid="cropper">
                {props.notice}
                <button onClick={() => props.onUseOriginal()}>as-is</button>
                <button onClick={() => props.onCroppedCanvas({ width: 10, height: 10 })}>crop</button>
                <button onClick={() => props.onOpenChange(false)}>cancel</button>
            </div>
        );
    },
}));

import { ImageUploadField } from './ImageUploadField';

beforeEach(() => {
    uploadFile.mockReset().mockResolvedValue('file-1');
    readImageSize.mockReset();
    prepareOriginal.mockReset();
    prepareCropped.mockReset();
    cropper.last = null;
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:picked');
    globalThis.URL.revokeObjectURL = vi.fn();
});

const pick = (file: File) => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
};

describe('ImageUploadField', () => {
    it('says what to upload for its slot, and "any shape" without one', () => {
        const { unmount } = render(<ImageUploadField label="Cover" value="" onChange={() => {}} slot="card" />);
        expect(screen.getByText('Best: 1280 × 720 px (16:9)')).toBeTruthy();
        unmount();
        render(<ImageUploadField label="Image" value="" onChange={() => {}} />);
        expect(screen.getByText('Best: at least 1600 px wide')).toBeTruthy();
    });

    it('opens the cropper at the slot shape, and uploads the crop', async () => {
        const onChange = vi.fn();
        readImageSize.mockResolvedValue({ width: 4000, height: 3000 });
        const cropped = new File(['c'], 'photo.jpg', { type: 'image/jpeg' });
        prepareCropped.mockResolvedValue(cropped);
        render(<ImageUploadField label="Cover" value="" onChange={onChange} slot="card" />);

        const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
        await act(async () => pick(file));
        await screen.findByTestId('cropper');
        expect(cropper.last!.aspectRatio).toBeCloseTo(16 / 9);
        expect(cropper.last!.src).toBe('blob:picked');
        expect(screen.getByText(/4000 × 3000 px/)).toBeTruthy();

        await act(async () => fireEvent.click(screen.getByText('crop')));
        await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://cdn/file-1'));
        expect(prepareCropped.mock.calls[0]![1]).toBe(file);
        expect(uploadFile.mock.calls[0]![0].file).toBe(cropped);
        expect(screen.queryByTestId('cropper')).toBeNull();
    });

    it('"Use as is" uploads the whole image, scaled for the slot', async () => {
        readImageSize.mockResolvedValue({ width: 1280, height: 720 });
        const file = new File(['x'], 'a.png', { type: 'image/png' });
        prepareOriginal.mockResolvedValue(file);
        render(<ImageUploadField label="Cover" value="" onChange={() => {}} slot="card" />);
        await act(async () => pick(file));
        await act(async () => fireEvent.click(await screen.findByText('as-is')));
        await waitFor(() => expect(uploadFile).toHaveBeenCalled());
        expect(prepareOriginal).toHaveBeenCalledWith(file, { width: 1280, height: 720 }, expect.objectContaining({ id: 'card' }));
    });

    it('uploads nothing when the cropper is cancelled', async () => {
        readImageSize.mockResolvedValue({ width: 1280, height: 720 });
        render(<ImageUploadField label="Cover" value="" onChange={() => {}} slot="card" />);
        await act(async () => pick(new File(['x'], 'a.jpg', { type: 'image/jpeg' })));
        await act(async () => fireEvent.click(await screen.findByText('cancel')));
        expect(screen.queryByTestId('cropper')).toBeNull();
        expect(uploadFile).not.toHaveBeenCalled();
    });

    it('uploads an SVG, or an image the browser cannot read, as it always did', async () => {
        render(<ImageUploadField label="Logo" value="" onChange={() => {}} slot="logo" />);
        const svg = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });
        await act(async () => pick(svg));
        await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1));
        expect(uploadFile.mock.calls[0]![0].file).toBe(svg);
        expect(readImageSize).not.toHaveBeenCalled();

        readImageSize.mockResolvedValue(null);
        const heic = new File(['x'], 'p.heic', { type: 'image/heic' });
        await act(async () => pick(heic));
        await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(2));
        expect(uploadFile.mock.calls[1]![0].file).toBe(heic);
        expect(screen.queryByTestId('cropper')).toBeNull();
    });

    it('warns about the current image once it has loaded: too small, or a shape shown whole', () => {
        render(<ImageUploadField label="Cover" value="https://cdn/tall.jpg" onChange={() => {}} slot="card" />);
        const img = screen.getByAltText('Preview') as HTMLImageElement;
        Object.defineProperty(img, 'naturalWidth', { value: 300 });
        Object.defineProperty(img, 'naturalHeight', { value: 600 });
        fireEvent.load(img);
        expect(document.querySelector('[data-image-advice="lowRes"]')).toBeTruthy();
        expect(document.querySelector('[data-image-advice="shape"]')).toBeTruthy();
    });

    it('shows a logo on a light and a dark surface', () => {
        render(<ImageUploadField label="Logo" value="https://cdn/logo.png" onChange={() => {}} slot="logo" />);
        expect(document.querySelectorAll('img[src="https://cdn/logo.png"]')).toHaveLength(2);
        expect(document.querySelector('.bg-neutral-900')).toBeTruthy();
    });
});
