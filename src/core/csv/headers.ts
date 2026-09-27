import type { FieldKey, ImportError, ImportWarning } from './types';

const EDGE_WHITESPACE = /^[ \t\u00A0]+|[ \t\u00A0]+$/g;
const INNER_WHITESPACE = /[ \t\u00A0]+/g;

/**
 * D3 matching key: trim and collapse U+0020 / U+0009 / U+00A0 runs to one space,
 * then fold ASCII A–Z only. Preserved header strings are never modified.
 */
export function normalizeHeaderKey(raw: string): string {
  return raw
    .replace(EDGE_WHITESPACE, '')
    .replace(INNER_WHITESPACE, ' ')
    .replace(/[A-Z]/g, (c) => c.toLowerCase());
}

interface FieldDefinition {
  required: boolean;
  /** Normalized keys accepted for this field. Exact-match only; no fuzzy matching. */
  aliases: readonly string[];
}

export const FIELD_DEFINITIONS: Readonly<Record<FieldKey, FieldDefinition>> = {
  volumeNumerator: { required: true, aliases: ['consolidated end of day vol'] },
  volumeDenominator: { required: true, aliases: ['consolidated 30d average end of day vol'] },
  isin: { required: true, aliases: ['isin'] },
  nseCode: { required: true, aliases: ['nse code'] },
  providerVolumeRatio: { required: false, aliases: ['volumeratio'] },
  serialNumber: { required: false, aliases: ['sl no'] },
};

export interface ColumnMapping {
  /** Column index per field; absent when missing or ambiguous. */
  columns: Partial<Record<FieldKey, number>>;
  errors: ImportError[];
  warnings: ImportWarning[];
}

export function mapColumns(headers: readonly string[]): ColumnMapping {
  const keys = headers.map(normalizeHeaderKey);
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];
  const columns: Partial<Record<FieldKey, number>> = {};

  const blank = indicesWhere(keys, (k) => k === '');
  if (blank.length > 0) warnings.push({ code: 'BLANK_HEADER', columns: blank });

  const byKey = new Map<string, number[]>();
  keys.forEach((k, i) => {
    if (k !== '') byKey.set(k, [...(byKey.get(k) ?? []), i]);
  });
  for (const idx of byKey.values()) {
    if (idx.length > 1) warnings.push({ code: 'DUPLICATE_HEADER', columns: idx });
  }

  for (const [field, def] of Object.entries(FIELD_DEFINITIONS) as [FieldKey, FieldDefinition][]) {
    const matches = indicesWhere(keys, (k) => def.aliases.includes(k));
    const [only] = matches;
    if (matches.length === 1 && only !== undefined) {
      columns[field] = only;
    } else if (matches.length === 0) {
      if (def.required) errors.push({ code: 'REQUIRED_COLUMN_MISSING', field });
    } else if (def.required) {
      errors.push({ code: 'REQUIRED_COLUMN_AMBIGUOUS', field, columns: matches });
    } else {
      warnings.push({ code: 'OPTIONAL_COLUMN_AMBIGUOUS', field, columns: matches });
    }
  }

  return { columns, errors, warnings };
}

function indicesWhere<T>(items: readonly T[], pred: (item: T) => boolean): number[] {
  const out: number[] = [];
  items.forEach((item, i) => {
    if (pred(item)) out.push(i);
  });
  return out;
}
