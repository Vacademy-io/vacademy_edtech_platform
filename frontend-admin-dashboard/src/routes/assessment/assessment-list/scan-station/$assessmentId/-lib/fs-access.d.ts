/**
 * The slice of the File System Access API the scan station uses. The project's
 * tsconfig has no "dom.asynciterable" lib, so FileSystemDirectoryHandle.values()
 * and window.showDirectoryPicker are not typed; these local shapes cover them
 * without changing the global lib for the whole app.
 */

export interface ScanFileHandle {
    kind: 'file';
    name: string;
    getFile(): Promise<File>;
}

export interface ScanDirectoryHandle {
    kind: 'directory';
    name: string;
    values(): AsyncIterable<ScanFileHandle | ScanDirectoryHandle>;
}

export interface DirectoryPickerHost {
    showDirectoryPicker?: (options?: {
        id?: string;
        mode?: 'read' | 'readwrite';
    }) => Promise<ScanDirectoryHandle>;
}
