import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { describe, expect, it } from 'vitest';
import { FIELD_KEYS, IMPORT_WARNING_CODES, PARTIAL_PAGE_REASONS } from '../../src/core/csv/types';
import { NUMERIC_DETAILS } from '../../src/core/csv/numeric';
import { VOLUME_RATIO_REASONS } from '../../src/core/csv/volumeRatio';
import { COMBINED_IMPORT_WARNING_CODES } from '../../src/core/envelope/types';
import { ROOT } from '../helpers';

const schemaDir = join(ROOT, 'src', 'core', 'envelope', 'schema');
const generatedDir = join(schemaDir, 'generated');

function readSchema(file: string): { $defs: Record<string, { enum?: unknown[] }> } {
  return JSON.parse(readFileSync(join(schemaDir, file), 'utf8')) as {
    $defs: Record<string, { enum?: unknown[] }>;
  };
}

describe('envelope v1 schema: single source of truth for code enums', () => {
  const schema = readSchema('envelope.v1.schema.json');

  it.each([
    ['fieldKey', FIELD_KEYS],
    ['importWarningCode', IMPORT_WARNING_CODES],
    ['partialPageReason', PARTIAL_PAGE_REASONS],
    ['volumeRatioReason', VOLUME_RATIO_REASONS],
    ['numericDetail', NUMERIC_DETAILS],
  ])('$defs.%s matches the TypeScript source array exactly', (defName, sourceArray) => {
    const enumValues = schema.$defs[defName]?.enum;
    expect(enumValues).toBeDefined();
    expect(enumValues).toEqual([...sourceArray]);
  });
});

describe('envelope v2 schema: single source of truth for code enums', () => {
  const schema = readSchema('envelope.v2.schema.json');

  it.each([
    ['fieldKey', FIELD_KEYS],
    ['importWarningCode', IMPORT_WARNING_CODES],
    ['partialPageReason', PARTIAL_PAGE_REASONS],
    ['volumeRatioReason', VOLUME_RATIO_REASONS],
    ['numericDetail', NUMERIC_DETAILS],
    ['combinedImportWarningCode', COMBINED_IMPORT_WARNING_CODES],
  ])('$defs.%s matches the TypeScript source array exactly', (defName, sourceArray) => {
    const enumValues = schema.$defs[defName]?.enum;
    expect(enumValues).toBeDefined();
    expect(enumValues).toEqual([...sourceArray]);
  });
});

describe.each([
  ['envelope.v1.schema.json', 'validateEnvelopeV1'],
  ['envelope.v2.schema.json', 'validateEnvelopeV2'],
])('envelope schema %s: generated validator is not stale', (schemaFile, outName) => {
  const schemaPath = join(schemaDir, schemaFile);
  const generatedPath = join(generatedDir, `${outName}.js`);

  it('regenerating from the current schema reproduces the committed file byte-for-byte', () => {
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as object;
    const ajv = new Ajv2020({
      code: { source: true, esm: true },
      allErrors: true,
      strict: true,
      unicode: false,
    });
    const validate = ajv.compile(schema);
    const code = standaloneCode(ajv, validate);
    const banner =
      '// GENERATED FILE — do not edit by hand.\n' +
      `// Produced by scripts/compile-schema.mjs from schema/${schemaFile}.\n` +
      '// Regenerate with: node scripts/compile-schema.mjs\n';
    const expected = banner + code;
    const actual = readFileSync(generatedPath, 'utf8');
    expect(actual).toBe(expected);
  });

  it('contains no runtime eval/new Function (CSP: no unsafe-eval needed)', () => {
    const code = readFileSync(generatedPath, 'utf8');
    expect(code).not.toMatch(/\bnew Function\b/);
    expect(code).not.toMatch(/\beval\s*\(/);
    expect(code).not.toMatch(/\brequire\s*\(/);
  });
});
