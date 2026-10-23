import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const solverFile = path.join(__dirname, 'node_modules', '@distube', 'ytdl-core', 'dist', 'solver', 'index.js');

if (fs.existsSync(solverFile)) {
  let content = fs.readFileSync(solverFile, 'utf8');
  if (content.includes('CALL_DEADLINE_MS = 10_000')) {
    content = content.replace('CALL_DEADLINE_MS = 10_000', 'CALL_DEADLINE_MS = 45_000');
    fs.writeFileSync(solverFile, content, 'utf8');
    console.log('✅ [Patch] CALL_DEADLINE_MS aumentado a 45_000 ms');
  } else {
    console.log('ℹ️ [Patch] Ya estaba parchado o no contiene CALL_DEADLINE_MS = 10_000');
  }
} else {
  console.log('⚠️ [Patch] Archivo solver/index.js no encontrado');
}
