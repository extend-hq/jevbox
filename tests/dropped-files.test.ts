import { test } from "node:test";
import assert from "node:assert/strict";
import { collectDroppedFiles } from "../src/lib/dropped-files";

function file(name: string): FileSystemEntry {
  return {
    name,
    isFile: true,
    isDirectory: false,
    file: (resolve: (file: File) => void) => resolve(new File([name], name)),
  } as unknown as FileSystemEntry;
}
function directory(name: string, entries: FileSystemEntry[]): FileSystemEntry {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let offset = 0;
      return {
        readEntries: (resolve: (entries: FileSystemEntry[]) => void) => {
          const batch = entries.slice(offset, offset + 40);
          offset += batch.length;
          resolve(batch);
        },
      };
    },
  } as unknown as FileSystemEntry;
}
function transfer(entries: FileSystemEntry[]): DataTransfer {
  return {
    items: entries.map((entry) => ({
      kind: "file",
      webkitGetAsEntry: () => entry,
      getAsFile: () => null,
    })),
    files: [],
  } as unknown as DataTransfer;
}
test("folder enumeration reads every batch and retains nested paths", async () => {
  const entries = Array.from({ length: 99 }, (_, index) =>
    file(`${index}.txt`),
  );
  entries.push(directory("Nested", [file("Child.txt")]));
  const result = await collectDroppedFiles(
    transfer([directory("Root", entries)]),
  );
  assert.equal(result.hasDirectory, true);
  assert.equal(result.files.length, 100);
  assert.equal(result.files[98].webkitRelativePath, "Root/98.txt");
  assert.equal(result.files[99].webkitRelativePath, "Root/Nested/Child.txt");
});
test("ordinary file drops use the file list without folder confirmation", async () => {
  const files = [new File(["content"], "File.txt")];
  const result = await collectDroppedFiles({
    items: [],
    files,
  } as unknown as DataTransfer);
  assert.equal(result.hasDirectory, false);
  assert.deepEqual(result.files, files);
});
test("a failed directory read rejects the drop instead of uploading a partial set", async () => {
  const broken = {
    name: "Unreadable",
    isDirectory: true,
    createReader: () => ({
      readEntries: (_resolve: unknown, reject: (error: Error) => void) =>
        reject(new Error("Read failed")),
    }),
  } as unknown as FileSystemEntry;
  await assert.rejects(
    collectDroppedFiles(
      transfer([directory("Root", [file("First.txt"), broken])]),
    ),
    /Read failed/,
  );
});

test("folder drops reject over 100 files without returning a partial batch", async () => {
  await assert.rejects(
    collectDroppedFiles(
      transfer([
        directory(
          "Root",
          Array.from({ length: 101 }, (_, i) => file(`${i}.txt`)),
        ),
      ]),
    ),
    /up to 100/,
  );
});
