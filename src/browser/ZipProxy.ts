import "./zip.js.d.ts"
import "./cordova-plugin-file.d.ts"
import * as zipjs from "@zip.js/zip.js";

var __CORDOVA_PLUGIN_UNZIP_LOG_DEBUG_ENABLED = false;
var __CORDOVA_PLUGIN_UNZIP_LOG_INFO_ENABLED = false;

function logDebug(...messages: any[]): void {
    if (__CORDOVA_PLUGIN_UNZIP_LOG_DEBUG_ENABLED) {
        console.debug(...messages);
    }
}

function logInfo(...messages: any[]): void {
    if (__CORDOVA_PLUGIN_UNZIP_LOG_INFO_ENABLED) {
        console.info(...messages);
    }
}

class CordovaPluginFileUtils {

    static isFileError(error: any, requestedError: CordovaPluginFileUtils.FileErrors): boolean {
        if (error.name && error.name == CordovaPluginFileUtils.FileErrors[requestedError]) {
            return true;
        }

        if (error.code && error.code == requestedError) {
            return true;
        }

        return false;
    }

    static getFileEntry(path: string, parentDirectory: DirectoryEntry): Promise<FileEntry> {
        return new Promise<FileEntry>((resolve, reject) => {
            parentDirectory.getFile(path, {}, resolve, reject);
        });
    }

    static resolveOrCreateDirectoryEntry(entryUrl: string): Promise<DirectoryEntry> {
        return CordovaPluginFileUtils.resolveOrCreateEntry(entryUrl, true) as Promise<DirectoryEntry>;
    }

    static resolveOrCreateFileEntry(entryUrl: string): Promise<FileEntry> {
        return CordovaPluginFileUtils.resolveOrCreateEntry(entryUrl, false) as Promise<FileEntry>;
    }

    static resolveEntry(entryUrl: string): Promise<DirectoryEntry | FileEntry> {
        return new Promise<Entry>((resolve, reject) => {
            window.resolveLocalFileSystemURL(entryUrl, resolve, reject);
        }) as Promise<DirectoryEntry | FileEntry>;
    }

    static async resolveOrCreateEntry(entryUrl: string, directory: boolean): Promise<DirectoryEntry | FileEntry> {
        let entry: DirectoryEntry | FileEntry;
        try {
            entry = await CordovaPluginFileUtils.resolveEntry(entryUrl);
        } catch (e) {
            console.error(e);
            console.error(`cannot resolve directory entry at url ${entryUrl}`);

            let fileSystem: FileSystem;
            if (entryUrl.indexOf('/temporary/') != -1) {
                fileSystem = await CordovaPluginFileUtils.getFileSystem(CordovaPluginFileUtils.FileSystemType.TEMPORARY);
            } else {
                fileSystem = await CordovaPluginFileUtils.getFileSystem();
            }
            let path: string = entryUrl;
            if (entryUrl.indexOf('/temporary/') != -1) {
                path = entryUrl.substring(entryUrl.indexOf('/temporary/') + '/temporary/'.length - 1);
            } else if (entryUrl.indexOf('/persistent/') != -1) {
                path = entryUrl.substring(entryUrl.indexOf('/persistent/') + '/persistent/'.length - 1);
            }

            entry = await new Promise<DirectoryEntry | FileEntry>((resolve, reject) => {
                if (directory) {
                    fileSystem.root.getDirectory(path, { create: true, exclusive: false }, resolve, reject);
                } else {
                    fileSystem.root.getFile(path, { create: true, exclusive: true }, resolve, reject);
                }
            });
        }

        return entry;
    }

    static getOrCreateChildDirectory(parent: DirectoryEntry, childDirPath: string): Promise<DirectoryEntry> {
        let folders: string[] = childDirPath.split('/');
        return CordovaPluginFileUtils.getOrCreateDirectoryForPath(parent, folders.filter(folder => folder != ''));
    }

    static async getOrCreateDirectoryForPath(parent: DirectoryEntry, pathEntries: string[]): Promise<DirectoryEntry> {
        pathEntries = pathEntries.filter(pathEntry => pathEntry != '');

        return new Promise<DirectoryEntry>((resolve, reject) => {
            logDebug('resolving dir path', pathEntries);

            if (pathEntries.length == 0) {
                return resolve(parent);
            }

            // Throw out './' or '/' and move on to prevent something like '/foo/.//bar'.
            if (pathEntries[0] == '.' || pathEntries[0] == '') {
                pathEntries = pathEntries.slice(1);
            }

            parent.getDirectory(pathEntries[0], { create: true }, (dirEntry: DirectoryEntry) => {
                logDebug('directory ' + pathEntries[0] + ' available, remaining: ' + (pathEntries.length - 1));

                // Recursively add the new subfolder (if we still have another to create).
                if (pathEntries.length > 1) {
                    CordovaPluginFileUtils.getOrCreateDirectoryForPath(dirEntry, pathEntries.slice(1))
                        .then(resolve)
                        .catch(reject);
                } else {
                    resolve(dirEntry);
                }
            }, reject);
        });
    }

    static getParent(entry: Entry): Promise<DirectoryEntry> {
        return new Promise<DirectoryEntry>((resolve, reject) => {
            entry.getParent(entry => resolve(entry as DirectoryEntry), reject);
        });
    }

    static async exists(path: string, parentDirectory: DirectoryEntry): Promise<boolean> {
        try {
            await CordovaPluginFileUtils.getFileEntry(path, parentDirectory);
            return true;
        } catch (error) {
            if (CordovaPluginFileUtils.isFileError(error, CordovaPluginFileUtils.FileErrors.TypeMismatchError)) {
                return true;
            }

            if (CordovaPluginFileUtils.isFileError(error, CordovaPluginFileUtils.FileErrors.NotFoundError)) {
                return false;
            }

            throw error;
        }
    }

    static async getEntryTypeAtPath(path: string, parentDirectory: DirectoryEntry): Promise<CordovaPluginFileUtils.EntryType> {
        try {
            await CordovaPluginFileUtils.getFileEntry(path, parentDirectory);
            return CordovaPluginFileUtils.EntryType.File;
        } catch (error) {
            if (CordovaPluginFileUtils.isFileError(error, CordovaPluginFileUtils.FileErrors.TypeMismatchError)) {
                return CordovaPluginFileUtils.EntryType.Directory;
            }

            throw error;
        }
    }

    private static fileSystemsCache: { [type: number]: FileSystem } = {};
    static async getFileSystem(type: CordovaPluginFileUtils.FileSystemType = CordovaPluginFileUtils.FileSystemType.PERSISTENT): Promise<FileSystem> {
        if (CordovaPluginFileUtils.fileSystemsCache[type]) {
            return CordovaPluginFileUtils.fileSystemsCache[type];
        }

        const requestFileSystem = window['webkitRequestFileSystem'] || window.requestFileSystem;
        const storageInfo = navigator['webkitPersistentStorage'] || window['storageInfo'];

        logDebug(`zip plugin - requestFileSystem=${requestFileSystem} - storageInfo=${storageInfo}`);

        // request storage quota
        const requestedBytes: number = (1000 * 1000000 /* ? x 1Mo */);
        let grantedBytes: number = 0;
        if (storageInfo != null) {
            grantedBytes = await new Promise<number>((resolve, reject) => {
                storageInfo.requestQuota(requestedBytes, resolve, reject);
            });
        }
        logDebug('granted bytes: ' + grantedBytes);

        // request file system
        if (!requestFileSystem) {
            throw new Error('cannot access filesystem API');
        }
        const fileSystem: FileSystem = await new Promise<FileSystem>((resolve, reject) => {
            requestFileSystem(type, grantedBytes, resolve, reject);
        });
        logDebug('FileSystem ready: ' + fileSystem.name);

        CordovaPluginFileUtils.fileSystemsCache[type] = fileSystem;

        return fileSystem;
    }

    static async listDirectoryContent(dir: DirectoryEntry, recursive: boolean = false): Promise<Entry[]> {
        const contentAvailable = new Promise<Entry[]>((resolve, reject) => {
            let dirReader = dir.createReader();
            let entries: Entry[] = [];

            let readEntries = () => {
                dirReader.readEntries((results) => {
                    if (!results.length) {
                        resolve(entries);
                    } else {
                        entries = entries.concat(results);
                        readEntries();
                    }
                }, reject);
            };

            readEntries();
        });

        const content: Entry[] = await contentAvailable;

        if (recursive) {
            const recursiveChildren: Entry[] = [];
            for (const directChild of content) {
                if (directChild.isDirectory) {
                    recursiveChildren.push(...(await CordovaPluginFileUtils.listDirectoryContent(<DirectoryEntry>directChild, true)));
                }
            }

            content.push(...recursiveChildren);
        }

        return content;
    }

    static getRelativePath(baseDirectory: DirectoryEntry, file: Entry): string {
        return file.fullPath //
            .replace(new RegExp('^/?/?' + baseDirectory.fullPath + '/?', 'g'), '') // removes //basePath/
            .replace(/\/$/g, ''); // removes trailing /
    }

    static async copyDirectoryWithOverwrite(
        sourceDirectory: DirectoryEntry,
        targetDirectory: DirectoryEntry,
        move: boolean = false,
        onProgress?: (loaded: number, total: number) => void) {

        const entries: Entry[] = await CordovaPluginFileUtils.listDirectoryContent(sourceDirectory, true);

        let i = 0;
        for (const entry of entries) {
            logInfo(`> copy ${entry.fullPath}`);

            let directoryToBeCopied: DirectoryEntry;
            if (entry.isDirectory) {
                directoryToBeCopied = entry as DirectoryEntry;
            } else {
                directoryToBeCopied = await CordovaPluginFileUtils.getParent(entry);
            }

            logDebug(`directory to be copied ${directoryToBeCopied.fullPath}`);

            const directoryRelativePath: string = CordovaPluginFileUtils.getRelativePath(sourceDirectory, directoryToBeCopied);
            let targetParentDirectory: DirectoryEntry = targetDirectory;
            if (directoryToBeCopied.fullPath != sourceDirectory.fullPath) {
                targetParentDirectory = await CordovaPluginFileUtils.getOrCreateChildDirectory(targetDirectory, directoryRelativePath);
            }
            logDebug('targetParentDirectory=' + targetDirectory.fullPath);

            if (!entry.isDirectory) {
                await new Promise<Entry>((resolve, reject) => {
                    if (move) {
                        logDebug(`move file ${entry.fullPath} to ${targetParentDirectory.fullPath}`);
                        entry.moveTo(targetParentDirectory, entry.name, resolve, reject);
                    } else {
                        logDebug(`copy file ${entry.fullPath} to ${targetParentDirectory.fullPath}`);
                        entry.copyTo(targetParentDirectory, entry.name, resolve, reject);
                    }
                });

                logInfo(`copied file: ${entry.fullPath} to ${targetParentDirectory.fullPath}`);
            }

            onProgress(++i, entries.length);
        }

        // remove source directory in move case
        if (move) {
            await CordovaPluginFileUtils.removeDirectory(sourceDirectory);
        }
    }

    static removeDirectory(directoryEntry: DirectoryEntry): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            directoryEntry.removeRecursively(resolve, reject);
        });
    }
}

namespace CordovaPluginFileUtils {

    export enum FileSystemType {
        TEMPORARY = window.TEMPORARY,
        PERSISTENT = window.PERSISTENT
    }

    export enum FileErrors {
        TypeMismatchError = 11,
        NotFoundError = 1
    }

    export enum EntryType {
        File,
        Directory
    }
}

async function unzipEntry(entry: zipjs.Entry, outputDirectoryEntry: DirectoryEntry) {
    logDebug(`extracting ${entry.filename} to ${outputDirectoryEntry.fullPath}`);
    let isDirectory = entry.filename.charAt(entry.filename.length - 1) == '/';

    let directoryPathEntries: string[] = entry.filename.split('/').filter(pathEntry => !!pathEntry);
    if (!isDirectory) {
        directoryPathEntries.splice(directoryPathEntries.length - 1, 1);
    }
    logInfo('directoryPathEntries=' + directoryPathEntries.join(', '));

    let targetDirectory: DirectoryEntry = outputDirectoryEntry;
    if (directoryPathEntries.length > 0) {
        targetDirectory = await CordovaPluginFileUtils.getOrCreateDirectoryForPath(outputDirectoryEntry, directoryPathEntries);
    }
    logInfo('targetDirectory=' + targetDirectory.fullPath);

    if (!isDirectory) {
        logDebug('adding file (get file): ' + entry.filename);
        const targetFileEntry = await new Promise<any>((resolve, reject) => {
            outputDirectoryEntry.getFile(entry.filename, { create: true, exclusive: false }, resolve, reject);
        });
        logDebug('adding file (write file): ' + entry.filename);
        let data = await entry.getData(new zipjs.BlobWriter());

        await writeBlobToFile(targetFileEntry, data);

        logDebug('added file: ' + entry.filename);
        const file: any = await getFileFromEntry(targetFileEntry);

        let unZipEvent: any = document.createEvent("Event");
        unZipEvent.initEvent("UNZIP_fileentry", false, false);
        unZipEvent.name = "UNZIP_fileentry";
        unZipEvent.data = { "file" : file, "targetFileEntry" : targetFileEntry };
        document.dispatchEvent(unZipEvent);
    }
}

async function loadFont(name: string, url: string | null) {
    // @ts-ignore
    const font = new FontFace(name, `url(${url})`);
    await font.load();             // Wait until font is downloaded and parsed
    (document as any).fonts.add(font);     // Add to document so it can be used
    console.log(`Font ${name} loaded`);
}
function loadImage(url: any) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);     // ✅ resolve with the image element
        img.onerror = (err) => reject(err);  // ❌ reject on error
        img.src = url;
        img.id = url;
        img.style.visibility = "hidden";
    });
}

function getFileFromEntry(fileEntry: any) {
    return new Promise((resolve, reject) => {
        fileEntry.file(resolve, reject);
    });
}

function createFileWriterAsync(fileEntry: any) {
    return new Promise((resolve, reject) => {
        fileEntry.createWriter(writer => {
            resolve(writer);
        }, reject);
    });
}
async function writeBlobToFile(fileEntry: any, blob: any) {
    const writer: any = await createFileWriterAsync(fileEntry);

    return new Promise((resolve, reject) => {
        writer.onwriteend = () => {
            console.log("Write complete.");
            resolve("");
        };
        writer.onerror = (e) => {
            console.error("Write failed:", e);
            reject(e);
        };

        writer.write(blob);
    });
}

interface SuccessCallback {
    (event: { loaded?: number, total: number }, options?): void;
}

async function unzip(
    zipFileUrl: string,
    outputDirectoryUrl: string,
    successCallback: SuccessCallback,
    errorCallback) {

    zip.useWebWorkers = false;

    function onProgress(loaded: number, total: number) {
        successCallback(
            { loaded, total },
            { keepCallback: true });
    }

    try {

        if (!zip) {
            throw new Error('zip.js not available, please import it: https://gildas-lormeau.github.io/zip.js');
        }

        logInfo(`unzipping ${zipFileUrl} to ${outputDirectoryUrl}`);

        logDebug(`retrieving output directory: ${outputDirectoryUrl}`);
        const outputDirectoryEntry: DirectoryEntry = await CordovaPluginFileUtils.resolveOrCreateDirectoryEntry(outputDirectoryUrl);
        logDebug(`output directory entry: ${outputDirectoryEntry}`);

        logDebug(`retrieving zip file: ${zipFileUrl}`);
        let zipEntry: FileEntry = await CordovaPluginFileUtils.resolveOrCreateFileEntry(zipFileUrl);
        logDebug(`zip file entry: ${zipEntry}`);

        const zipBlob: Blob = await new Promise<Blob>((resolve, reject) => {
            zipEntry.file(resolve, reject);
        });

        logInfo(`open reader on zip: ${zipFileUrl}`);
        let zipReader = new zipjs.ZipReader(new zipjs.BlobReader(zipBlob));

        logDebug(`reader opened on zip: ${zipFileUrl}`);
        let zipEntries = await zipReader.getEntries();

        logDebug(`entries read: ${zipFileUrl}`);

        onProgress(0, zipEntries.length);

        try {

            let i = 0;
            for (const entry of zipEntries) {
                await unzipEntry(entry, outputDirectoryEntry);

                onProgress(++i, zipEntries.length);
            }

            await zipReader.close();

            logInfo(`unzip OK from ${zipFileUrl} to ${outputDirectoryUrl}`);
            successCallback({
                total: zipEntries.length
            });
        } catch (e) {
            console.error(e, `error while unzipping ${zipFileUrl} to ${outputDirectoryUrl}`);
            zipReader.close();
            errorCallback(e);
        }

    } catch (e) {
        console.error(e, `error while unzipping ${zipFileUrl} to ${outputDirectoryUrl}`);
        errorCallback(e);
    }
}

declare var module;
declare var require;

module.exports = {
    unzip: function (successCallback, errorCallback, args) {
        const [zipFileUrl, outputDirectoryUrl] = args;
        unzip(zipFileUrl, outputDirectoryUrl, successCallback, errorCallback);
    }
};

require("cordova/exec/proxy").add("Zip", module.exports);