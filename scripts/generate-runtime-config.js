import fs from 'node:fs';
import path from 'node:path';

const output = path.join(process.cwd(), 'public', 'runtime-config.js');
const apiBaseUrl = process.env.API_BASE_URL || '';
fs.writeFileSync(output, `window.GITARU_API_BASE_URL = ${JSON.stringify(apiBaseUrl)};\n`, 'utf8');
console.log(`Generated ${output}`);
