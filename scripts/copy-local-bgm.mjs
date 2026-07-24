import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const sourceDirectory = 'assets/bgm';
const destinationDirectory = 'dist/public/assets/bgm';

await mkdir(destinationDirectory, { recursive: true });

for (const entry of await readdir(destinationDirectory, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp3')) {
    await rm(join(destinationDirectory, entry.name));
  }
}

let sourceEntries = [];
try {
  sourceEntries = await readdir(sourceDirectory, { withFileTypes: true });
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

await Promise.all(
  sourceEntries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.mp3'))
    .map((entry) => copyFile(
      join(sourceDirectory, entry.name),
      join(destinationDirectory, entry.name)
    ))
);
