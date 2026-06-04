import { readFile, writeFile } from 'node:fs/promises';

const CLIENT_DIRECTIVE = '"use client";\n';
const entryFiles = ['dist/index.js', 'dist/react.js', 'dist/react-ui.js'];

for (const file of entryFiles) {
  const source = await readFile(file, 'utf8');
  if (!source.startsWith(CLIENT_DIRECTIVE)) {
    await writeFile(file, `${CLIENT_DIRECTIVE}${source}`);
  }
}
