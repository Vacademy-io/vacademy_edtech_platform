// Bulk Content Uploading — zip layout parsing.
//
// Entries are synthesized rather than read from a real zip so the suite stays
// portable; the shapes mirror what @zip.js/zip.js hands back (directory entries
// carry no trailing slash once normalized by openZipFile).

import { describe, expect, it } from 'vitest';
import { buildTree, detectKind, type ZipEntryMeta } from './conventions';

const file = (path: string, uncompressedSize = 1024): ZipEntryMeta => ({
    path,
    isDirectory: false,
    uncompressedSize,
    utf8Name: true,
});

const dir = (path: string): ZipEntryMeta => ({
    path,
    isDirectory: true,
    uncompressedSize: 0,
    utf8Name: true,
});

const parse = (entries: ZipEntryMeta[], courseDepth = 3) =>
    buildTree({
        entries,
        courseDepth,
        zipFileName: 'test.zip',
        zipTotalBytes: 1024,
        fingerprint: 'test',
        readText: async () => '',
    });

const emptyFolderIssues = (issues: { path: string; message: string }[]) =>
    issues.filter((i) => i.message.includes('(empty)')).map((i) => i.path);

describe('detectKind', () => {
    it('maps a nested zip to a SCORM package', () => {
        expect(detectKind('course_SCORM_1.2.zip')).toBe('SCORM');
    });

    it('still treats office formats as themselves, not as zips', () => {
        // .docx/.pptx are zip containers too — extension order matters.
        expect(detectKind('notes.docx')).toBe('DOC');
        expect(detectKind('deck.pptx')).toBe('PPT');
    });
});

describe('buildTree — empty folders', () => {
    // Two content folders on purpose: with only one, the root-unwrap heuristic
    // treats it as a wrapper and strips it, which is a different code path.
    it('reports a folder that holds nothing but junk', async () => {
        const result = await parse([
            dir('Day 1'),
            file('Day 1/lesson.pdf'),
            dir('Day 2'),
            file('Day 2/.DS_Store'),
            dir('Day 3'),
            file('Day 3/notes.pdf'),
        ]);
        expect(emptyFolderIssues(result.issues)).toEqual(['Day 2']);
        expect(
            Object.values(result.nodes)
                .map((n) => n.displayName)
                .sort()
        ).toEqual(['Day 1', 'Day 3']);
    });

    it('does not report the auto-stripped root wrapper as empty', async () => {
        const result = await parse([
            dir('my-content'),
            dir('my-content/Day 1'),
            file('my-content/Day 1/lesson.pdf'),
            dir('my-content/Day 2'),
        ]);
        expect(emptyFolderIssues(result.issues)).toEqual(['Day 2']);
    });

    it('reports an empty parent once instead of every empty child', async () => {
        const result = await parse(
            [
                dir('Physics'),
                dir('Physics/Mechanics'),
                file('Physics/Mechanics/notes.pdf'),
                dir('Biology'),
                dir('Biology/Cells'),
                file('Biology/Cells/notes.pdf'),
                dir('Chemistry'),
                dir('Chemistry/Organic'),
            ],
            4
        );
        // Chemistry is empty, so Chemistry/Organic needs no separate line.
        expect(emptyFolderIssues(result.issues)).toEqual(['Chemistry']);
    });

    it('stays quiet when every folder has content', async () => {
        const result = await parse([
            dir('Day 1'),
            file('Day 1/lesson.pdf'),
            dir('Day 2'),
            file('Day 2/package_SCORM.zip'),
        ]);
        expect(emptyFolderIssues(result.issues)).toEqual([]);
        expect(
            Object.values(result.items)
                .map((i) => i.kind)
                .sort()
        ).toEqual(['PDF', 'SCORM']);
    });

    it('ignores sub-folders deeper than the course depth', async () => {
        // Deeper folders are folded into the slide title, not skipped, so they
        // must not be reported as empty.
        const result = await parse([
            dir('Day 1'),
            dir('Day 1/extras'),
            file('Day 1/extras/lesson.pdf'),
        ]);
        expect(emptyFolderIssues(result.issues)).toEqual([]);
    });

    it('says nothing about empty folders on a flat depth-2 zip', async () => {
        const result = await parse([dir('scratch'), file('lesson.pdf')], 2);
        expect(emptyFolderIssues(result.issues)).toEqual([]);
    });

    // A folder that visibly holds a file must never be called empty — the file
    // already got its own precise message, and two contradictory lines about
    // one folder is worse than either alone.
    it('stays quiet about a folder whose file sits at the wrong depth', async () => {
        const result = await parse(
            [
                dir('Maths'),
                file('Maths/formulae.pdf'), // one level too shallow for depth 4
                dir('Physics'),
                dir('Physics/Ch 1'),
                file('Physics/Ch 1/a.pdf'),
            ],
            4
        );
        expect(emptyFolderIssues(result.issues)).toEqual([]);
        // The accurate placement error still stands on its own.
        expect(result.issues.some((i) => i.message.includes('Not inside a'))).toBe(true);
    });

    it('stays quiet about a folder holding only unsupported files', async () => {
        const result = await parse([
            dir('Day 1'),
            file('Day 1/lesson.pdf'),
            dir('Day 2'),
            file('Day 2/notes.xyz'),
        ]);
        expect(emptyFolderIssues(result.issues)).toEqual([]);
        expect(result.issues.some((i) => i.message.includes('Unsupported file type'))).toBe(true);
    });

    // A part-filled template legitimately leaves many folders empty, so the
    // list is capped rather than flooding the issues panel.
    it('names the first five empty folders and counts the rest', async () => {
        const empties = Array.from({ length: 9 }, (_, i) => dir(`Empty ${i + 1}`));
        const result = await parse([
            dir('Day 1'),
            file('Day 1/lesson.pdf'),
            dir('Day 2'),
            file('Day 2/notes.pdf'),
            ...empties,
        ]);
        const named = emptyFolderIssues(result.issues);
        expect(named).toHaveLength(5);
        expect(
            result.issues.some(
                (i) => i.message === '4 more folders had no supported files and were skipped.'
            )
        ).toBe(true);
    });

    it('says "1 more folder ... was skipped" rather than "1 more folders"', async () => {
        const empties = Array.from({ length: 6 }, (_, i) => dir(`Empty ${i + 1}`));
        const result = await parse([
            dir('Day 1'),
            file('Day 1/lesson.pdf'),
            dir('Day 2'),
            file('Day 2/notes.pdf'),
            ...empties,
        ]);
        expect(
            result.issues.some(
                (i) => i.message === '1 more folder had no supported files and was skipped.'
            )
        ).toBe(true);
    });
});
