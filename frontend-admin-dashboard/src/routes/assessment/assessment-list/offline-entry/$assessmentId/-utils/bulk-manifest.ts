// Bulk offline data entry — CSV manifest + sample-zip helpers.
//
// The zip is read with @zip.js/zip.js (already a dependency, used by bulk content
// uploading): it lists entries from the central directory and streams ONE entry at
// a time, so a 500-sheet scan batch never has to fit in memory at once.

import Papa from 'papaparse';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import type { ZipHandle } from '@/components/common/study-library/bulk-content-uploading/zip-parser';
import type { StudentRow } from '../-components/StudentSelector';

export const MANIFEST_COLUMNS = [
    'username',
    'full_name',
    'total_marks',
    'student_pdf',
    'checked_pdf',
    'report_pdf',
] as const;

// No single column is required. A row needs SOME way to identify its student:
// either a username cell, or a named file whose name is the username. So the
// only unusable manifest is one with neither a username column nor any file
// column — every other shape resolves per row.
const IDENTIFYING_COLUMNS = ['username', 'student_pdf', 'checked_pdf', 'report_pdf'] as const;

export const SAMPLE_FOLDERS = ['answers', 'checked', 'reports'] as const;

export interface ManifestRow {
    /** 1-based CSV line number (excluding the header), for error messages. */
    line: number;
    username: string;
    totalMarks: number | null;
    /** Zip paths, already resolved against the archive's real entries. */
    studentPath: string | null;
    checkedPath: string | null;
    reportPath: string | null;
    /** Slots filled from the zip's folder layout rather than a CSV cell. */
    autoMatchedSlots: AttachmentSlotKey[];
    /** Resolved student; null when the username matched nobody. */
    student: StudentRow | null;
    /** Blocking problems — a row with any error is not imported. */
    errors: string[];
}

export interface ParsedManifest {
    rows: ManifestRow[];
    validRows: ManifestRow[];
    /** Zip entries no manifest row referenced — usually a typo or a stray scan. */
    unreferencedFiles: string[];
    /** Headers we don't understand — flagged so a typo'd column isn't silent. */
    unrecognizedHeaders: string[];
    /** Problems with the file as a whole (missing username column, unreadable CSV). */
    fatalErrors: string[];
}

const normalizeHeader = (header: string): string =>
    header.trim().toLowerCase().replace(/\s+/g, '_');

const normalizeKey = (value: string | undefined): string => (value ?? '').trim().toLowerCase();

/** Strips folders and case so `Answers/STU001.PDF` still finds `answers/stu001.pdf`. */
const basename = (path: string): string => path.split('/').pop() ?? path;

/**
 * Resolves a manifest cell to a real zip path. Accepts a full path or just the
 * file name — scanners and spreadsheet software both mangle these, and failing an
 * otherwise-correct row over a leading `./` helps nobody.
 */
const resolveZipPath = (cell: string, filesByPath: Map<string, string>, filesByName: Map<string, string[]>) => {
    const raw = cell.trim().replace(/^\.?\//, '');
    if (!raw) return { path: null as string | null, error: null as string | null };

    const byPath = filesByPath.get(raw.toLowerCase());
    if (byPath) return { path: byPath, error: null };

    const matches = filesByName.get(basename(raw).toLowerCase()) ?? [];
    if (matches.length === 1) return { path: matches[0] as string, error: null };
    if (matches.length > 1) {
        return {
            path: null,
            error: `"${raw}" matches ${matches.length} files in the zip — use the full path inside the zip`,
        };
    }
    return { path: null, error: `"${raw}" was not found in the zip` };
};

// Folder names that identify which slot a scan belongs to, so a zip laid out as
// answers/<username>.pdf works with no file names typed into the CSV at all.
// Naming a file in the CSV always wins; this is only the fallback.
const SLOT_FOLDER_ALIASES: Record<AttachmentSlotKey, string[]> = {
    student: ['answers', 'answer', 'student', 'students', 'submitted', 'submission', 'submissions'],
    checked: ['checked', 'evaluated', 'marked', 'corrected', 'correction'],
    report: ['reports', 'report', 'result', 'results'],
};

export type AttachmentSlotKey = 'student' | 'checked' | 'report';

/** File name minus its extension, lowercased — the key files are matched on. */
const stem = (path: string): string =>
    basename(path).replace(/\.[^./]+$/, '').trim().toLowerCase();

const folderSlot = (path: string): AttachmentSlotKey | null => {
    const folders = path.split('/').slice(0, -1).map((segment) => segment.trim().toLowerCase());
    for (const [slot, aliases] of Object.entries(SLOT_FOLDER_ALIASES)) {
        if (folders.some((folder) => aliases.includes(folder))) return slot as AttachmentSlotKey;
    }
    return null;
};

type AutoIndex = Record<AttachmentSlotKey, Map<string, string[]>>;

/**
 * Indexes the zip by slot folder and file stem, so `answers/STU001.pdf` can be
 * found from the username alone. Files outside a recognised folder are skipped —
 * guessing a slot from a bare file name would risk filing a raw answer sheet as
 * the checked copy, which is worse than asking for the CSV cell.
 */
const buildAutoIndex = (zip: ZipHandle): AutoIndex => {
    const index: AutoIndex = { student: new Map(), checked: new Map(), report: new Map() };
    for (const entry of zip.entries) {
        if (entry.isDirectory) continue;
        if (entry.path.toLowerCase().endsWith('.csv')) continue;
        const slot = folderSlot(entry.path);
        if (!slot) continue;
        const key = stem(entry.path);
        index[slot].set(key, [...(index[slot].get(key) ?? []), entry.path]);
    }
    return index;
};

/**
 * Finds this student's file in a slot folder. Matches `<username>.pdf` exactly,
 * then `<username>_checked.pdf`-style prefixes. Ambiguity is reported rather than
 * guessed — attaching the wrong student's paper is the one failure that must not
 * happen silently.
 */
const autoMatch = (
    index: AutoIndex,
    slot: AttachmentSlotKey,
    username: string
): { path: string | null; error: string | null } => {
    const key = normalizeKey(username);
    if (!key) return { path: null, error: null };

    const exact = index[slot].get(key) ?? [];
    if (exact.length === 1) return { path: exact[0] as string, error: null };
    if (exact.length > 1) {
        return { path: null, error: `${exact.length} files in the ${slot} folder are named "${username}"` };
    }

    const prefixed: string[] = [];
    for (const [candidateStem, paths] of index[slot]) {
        if (candidateStem.startsWith(key) && /^[^a-z0-9]/.test(candidateStem.slice(key.length))) {
            prefixed.push(...paths);
        }
    }
    if (prefixed.length === 1) return { path: prefixed[0] as string, error: null };
    if (prefixed.length > 1) {
        return {
            path: null,
            error: `${prefixed.length} files in the ${slot} folder start with "${username}" — name the exact file in the CSV`,
        };
    }
    return { path: null, error: null };
};

/**
 * Works out which student a row is for from the file names it points at, for
 * rows with no username cell. `checked/STU001.pdf` already says STU001 — making
 * someone re-type that in a username column is pure busywork.
 *
 * Every named file must agree on the student. Disagreement is an error, never a
 * guess: attaching one student's paper to another is the one failure that must
 * not happen quietly.
 */
const deriveStudentFromPaths = (
    paths: string[],
    studentsByUsername: Map<string, StudentRow>
): { username: string; student: StudentRow | null; error: string | null } => {
    const empty = { username: '', student: null, error: null as string | null };
    if (paths.length === 0) {
        return {
            ...empty,
            error: 'no username, and no file to work it out from — add a username or name a file',
        };
    }

    const matched = new Map<string, StudentRow>();
    const unmatchedStems: string[] = [];
    for (const path of paths) {
        // Tolerate `STU001_checked.pdf` by also trying the part before the first
        // separator, so a descriptive suffix doesn't break identification.
        const full = stem(path);
        const prefix = full.split(/[^a-z0-9]/)[0] ?? full;
        const hit = studentsByUsername.get(full) ?? studentsByUsername.get(prefix);
        if (hit) matched.set(normalizeKey(hit.username), hit);
        else unmatchedStems.push(basename(path));
    }

    if (matched.size > 1) {
        return {
            ...empty,
            error: `files in this row belong to different students (${[...matched.values()].map((s) => s.username).join(', ')}) — split them across rows`,
        };
    }
    if (matched.size === 0) {
        return {
            ...empty,
            error: `could not tell which student "${unmatchedStems.join('", "')}" belongs to — name the file after their username, or add a username column`,
        };
    }

    const student = [...matched.values()][0] as StudentRow;
    if (unmatchedStems.length > 0) {
        return {
            username: student.username,
            student,
            error: `"${unmatchedStems.join('", "')}" does not match ${student.username} — add a username column to be sure`,
        };
    }
    return { username: student.username, student, error: null };
};

/** Builds the CSV template, pre-filled with the students in this assessment. */
export const buildManifestCsv = (students: StudentRow[]): string => {
    const rows = students
        .filter((s) => s.username)
        .map((s) => ({
            username: s.username,
            full_name: s.name,
            total_marks: '',
            student_pdf: '',
            checked_pdf: '',
            report_pdf: '',
        }));

    // Even with no students the header alone is a usable template.
    return Papa.unparse({ fields: [...MANIFEST_COLUMNS], data: rows });
};

export const downloadTextFile = (content: string, fileName: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
};

const SAMPLE_README = `Bulk offline data entry
=======================

1. Put your scanned PDFs in these folders, named after the student's username:

     answers/<username>.pdf   the student's own answer sheet
     checked/<username>.pdf   the checked (annotated) copy
     reports/<username>.pdf   a result report you prepared outside the platform

   Files in these folders are picked up automatically — you do NOT have to type
   their names into manifest.csv. (A suffix works too: checked/STU001_checked.pdf.)

   If you'd rather keep a different layout, put the files anywhere and name them
   in manifest.csv instead. A name in the CSV always wins over the folder.

   Anything that is neither named in the CSV nor in one of these folders is
   IGNORED — the preview tells you how many files that is before you import.

2. Fill in manifest.csv. NO column is required — delete any you don't need, or
   leave individual cells blank; both mean "skip this one".

     username      The student's enrolment number / username (case-insensitive).
                   You can leave this out entirely IF the files you name are
                   named after the student — checked_pdf = STU001.pdf is enough
                   to identify STU001 on its own.
     full_name     Ignored on import — it is there so you can see who is who
                   while filling the sheet in.
     total_marks   The total the student scored. It can be negative when the
                   paper has negative marking (e.g. -5).
     student_pdf   Path (or just the file name) of their answer sheet.
     checked_pdf   Path of the checked copy.
     report_pdf    Path of the report.

   All of these are valid manifests:

     username,total_marks              marks only, files picked up from folders
     checked_pdf                       file name identifies the student
     username,checked_pdf,report_pdf   fully explicit

   Each row needs a way to identify its student (a username, or a file named
   after one) and at least one thing to import (marks or a file).

3. Zip it back up and upload it. You will see a row-by-row preview before
   anything is saved.

Note: entering total_marks releases that student's result to them.
`;

/** Builds a downloadable sample zip: the pre-filled manifest + folder layout. */
export const buildSampleZip = async (students: StudentRow[]): Promise<Blob> => {
    const zipWriter = new ZipWriter(new BlobWriter('application/zip'));

    await zipWriter.add('manifest.csv', new TextReader(buildManifestCsv(students)));
    await zipWriter.add('README.txt', new TextReader(SAMPLE_README));
    for (const folder of SAMPLE_FOLDERS) {
        // Directory entries carry no data — zip.js wants the reader omitted
        // (`undefined`), not `null`, which its overloads don't accept.
        await zipWriter.add(`${folder}/`, undefined, { directory: true });
    }

    return zipWriter.close();
};

/** Finds the manifest inside the zip: `manifest.csv`, else the only root-level CSV. */
export const findManifestPath = (zip: ZipHandle): string | null => {
    const csvFiles = zip.entries.filter((e) => !e.isDirectory && e.path.toLowerCase().endsWith('.csv'));
    const named = csvFiles.find((e) => basename(e.path).toLowerCase() === 'manifest.csv');
    if (named) return named.path;

    const atRoot = csvFiles.filter((e) => !e.path.includes('/'));
    if (atRoot.length === 1) return (atRoot[0] as { path: string }).path;
    return null;
};

/**
 * Parses the manifest against the zip's real contents and the assessment's
 * students. Nothing is uploaded here — this exists so the admin sees every
 * problem BEFORE a single file leaves their machine.
 */
export const parseManifest = (
    csvText: string,
    zip: ZipHandle,
    students: StudentRow[]
): ParsedManifest => {
    const fatalErrors: string[] = [];

    const parsed = Papa.parse<Record<string, string>>(csvText, {
        header: true,
        skipEmptyLines: 'greedy',
        transformHeader: normalizeHeader,
    });

    const headers = (parsed.meta.fields ?? []).map(normalizeHeader);
    if (!IDENTIFYING_COLUMNS.some((column) => headers.includes(column))) {
        fatalErrors.push(
            `manifest.csv needs either a "username" column or a file column (${IDENTIFYING_COLUMNS.slice(1).join(', ')}) — one of them has to say which student each row is for.`
        );
    }

    // Not an error, just worth saying: a typo'd header ("marks" instead of
    // "total_marks") would otherwise look like a file that imported fine but
    // silently dropped every score.
    const recognized = new Set<string>(MANIFEST_COLUMNS);
    const unrecognizedHeaders = headers.filter((header) => header && !recognized.has(header));

    // Index the zip once — by full path and by bare file name.
    const filesByPath = new Map<string, string>();
    const filesByName = new Map<string, string[]>();
    for (const entry of zip.entries) {
        if (entry.isDirectory) continue;
        filesByPath.set(entry.path.toLowerCase(), entry.path);
        const name = basename(entry.path).toLowerCase();
        filesByName.set(name, [...(filesByName.get(name) ?? []), entry.path]);
    }

    // Bulk import matches on username, which only the batch-learner listing
    // carries — individually registered participants have no username to match.
    const studentsByUsername = new Map<string, StudentRow>();
    for (const student of students) {
        const key = normalizeKey(student.username);
        if (key) studentsByUsername.set(key, student);
    }

    const autoIndex = buildAutoIndex(zip);
    const seenUsernames = new Map<string, number>();
    const referenced = new Set<string>();

    const rows: ManifestRow[] = (parsed.data ?? []).map((raw, index) => {
        const line = index + 1;
        const errors: string[] = [];

        // Resolve the CSV-named files FIRST: when the username cell is blank the
        // file name itself identifies the student (checked/STU001.pdf -> STU001),
        // so requiring a username you already spelled out in the path is busywork.
        const namedPaths: Partial<Record<AttachmentSlotKey, string>> = {};
        const namedColumns: Array<[AttachmentSlotKey, 'student_pdf' | 'checked_pdf' | 'report_pdf']> = [
            ['student', 'student_pdf'],
            ['checked', 'checked_pdf'],
            ['report', 'report_pdf'],
        ];
        for (const [slot, column] of namedColumns) {
            const { path, error } = resolveZipPath(raw[column] ?? '', filesByPath, filesByName);
            if (error) errors.push(`${column}: ${error}`);
            if (path) {
                namedPaths[slot] = path;
                referenced.add(path);
            }
        }

        const explicitUsername = (raw.username ?? '').trim();
        const derived = explicitUsername
            ? { username: explicitUsername, student: studentsByUsername.get(normalizeKey(explicitUsername)) ?? null, error: null as string | null }
            : deriveStudentFromPaths(Object.values(namedPaths), studentsByUsername);

        const username = derived.username;
        const student = derived.student;
        if (derived.error) {
            errors.push(derived.error);
        } else if (username && !student) {
            errors.push(`no student with username "${username}" in this assessment`);
        }

        const duplicateOf = username ? seenUsernames.get(normalizeKey(username)) : undefined;
        if (duplicateOf !== undefined) {
            errors.push(`duplicate of line ${duplicateOf} — the later row would overwrite the earlier one`);
        } else if (username) {
            seenUsernames.set(normalizeKey(username), line);
        }

        const rawMarks = (raw.total_marks ?? '').trim();
        let totalMarks: number | null = null;
        if (rawMarks) {
            const value = Number(rawMarks);
            // Negative totals are real scores on papers with negative marking
            // (e.g. -5), and the backend stores them as-is, so only reject
            // values that are not numbers at all.
            if (!Number.isFinite(value)) {
                errors.push(`total_marks "${rawMarks}" is not a valid score`);
            } else {
                totalMarks = value;
            }
        }

        const autoMatchedSlots: AttachmentSlotKey[] = [];

        // Slots the CSV didn't name fall back to the zip's own layout
        // (answers/ checked/ reports/ named after the username). Without this,
        // PDFs sitting in those folders were silently ignored and only the marks
        // imported. Needs a resolved username, hence running after derivation.
        const resolveSlot = (slot: AttachmentSlotKey, column: string) => {
            const named = namedPaths[slot];
            if (named) return named;
            if (!username) return null;
            const auto = autoMatch(autoIndex, slot, username);
            if (auto.error) errors.push(`${column}: ${auto.error}`);
            if (auto.path) {
                referenced.add(auto.path);
                autoMatchedSlots.push(slot);
            }
            return auto.path;
        };

        const studentPath = resolveSlot('student', 'student_pdf');
        const checkedPath = resolveSlot('checked', 'checked_pdf');
        const reportPath = resolveSlot('report', 'report_pdf');

        if (totalMarks === null && !studentPath && !checkedPath && !reportPath && errors.length === 0) {
            errors.push('nothing to import — set total_marks or at least one file');
        }

        return {
            line,
            username,
            totalMarks,
            studentPath,
            checkedPath,
            reportPath,
            autoMatchedSlots,
            student,
            errors,
        };
    });

    const unreferencedFiles = zip.entries
        .filter(
            (entry) =>
                !entry.isDirectory &&
                !referenced.has(entry.path) &&
                !entry.path.toLowerCase().endsWith('.csv') &&
                basename(entry.path).toLowerCase() !== 'readme.txt'
        )
        .map((entry) => entry.path);

    return {
        rows,
        validRows: fatalErrors.length > 0 ? [] : rows.filter((row) => row.errors.length === 0),
        unreferencedFiles,
        unrecognizedHeaders,
        fatalErrors,
    };
};

/** Turns failures into a CSV the admin can fix and re-upload. */
export const buildErrorCsv = (
    rows: Array<{ line: number; username: string; errors: string[] }>
): string =>
    Papa.unparse({
        fields: ['line', 'username', 'problem'],
        data: rows.map((row) => ({
            line: row.line,
            username: row.username,
            problem: row.errors.join('; '),
        })),
    });
