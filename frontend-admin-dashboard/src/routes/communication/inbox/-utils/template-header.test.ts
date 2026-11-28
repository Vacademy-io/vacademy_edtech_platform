import { describe, expect, it } from 'vitest';
import { templateHeaderKind } from './template-header';

describe('templateHeaderKind', () => {
    it('maps the media header types Meta stores (uppercase) to the send API form (lowercase)', () => {
        expect(templateHeaderKind({ headerType: 'DOCUMENT' })).toBe('document');
        expect(templateHeaderKind({ headerType: 'IMAGE' })).toBe('image');
        expect(templateHeaderKind({ headerType: 'VIDEO' })).toBe('video');
    });

    it('tolerates lowercase and padded values', () => {
        expect(templateHeaderKind({ headerType: 'document' })).toBe('document');
        expect(templateHeaderKind({ headerType: ' Image ' })).toBe('image');
    });

    it('returns null for headers that need no file, and for a missing header type', () => {
        expect(templateHeaderKind({ headerType: 'TEXT' })).toBeNull();
        expect(templateHeaderKind({ headerType: 'NONE' })).toBeNull();
        expect(templateHeaderKind({ headerType: '' })).toBeNull();
        expect(templateHeaderKind({ headerType: undefined as unknown as string })).toBeNull();
    });
});
