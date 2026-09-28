// Node-only build step (never bundled into the app): precompiles the envelope JSON Schemas
// into standalone validator modules with no runtime `new Function`/`eval`, so the app's CSP
// never needs 'unsafe-eval' (brief: "Security & import handling"; D12).
//
// Run with: node scripts/compile-schema.mjs
// Regenerate whenever an envelope.v*.schema.json file changes; tests
// (tests/unit/envelope-schema-codegen.test.ts) assert the committed output is not stale.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const schemaDir = join(root, 'src', 'core', 'envelope', 'schema');

const TARGETS = [
  { schema: 'envelope.v1.schema.json', out: 'validateEnvelopeV1' },
  { schema: 'envelope.v2.schema.json', out: 'validateEnvelopeV2' },
];

for (const { schema: schemaFile, out } of TARGETS) {
  const schemaPath = join(schemaDir, schemaFile);
  const outPath = join(schemaDir, 'generated', `${out}.js`);
  const dtsPath = join(schemaDir, 'generated', `${out}.d.ts`);

  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

  const ajv = new Ajv2020({
    code: { source: true, esm: true },
    allErrors: true,
    strict: true,
    // Avoids emitting a `require("ajv/dist/runtime/ucs2length")` call in the standalone output
    // (Ajv's ESM codegen does not itself import that runtime helper as ESM). Our only minLength
    // uses are "non-empty string" checks, where UTF-16-code-unit length and Unicode-code-point
    // length agree, so this changes no observable validation behaviour here.
    unicode: false,
  });
  const validate = ajv.compile(schema);
  const code = standaloneCode(ajv, validate);

  const banner = `// GENERATED FILE — do not edit by hand.\n// Produced by scripts/compile-schema.mjs from schema/${schemaFile}.\n// Regenerate with: node scripts/compile-schema.mjs\n`;

  writeFileSync(outPath, banner + code, 'utf8');
  writeFileSync(
    dtsPath,
    banner +
      `export interface AjvValidationError {\n` +
      `  instancePath: string;\n` +
      `  schemaPath: string;\n` +
      `  keyword: string;\n` +
      `  message?: string;\n` +
      `}\n` +
      `export interface EnvelopeValidator {\n` +
      `  (data: unknown): boolean;\n` +
      `  errors?: AjvValidationError[] | null;\n` +
      `}\n` +
      `export const validate: EnvelopeValidator;\n` +
      `export default validate;\n`,
    'utf8',
  );

  console.log(`Wrote ${outPath} (${code.length} bytes)`);
}
