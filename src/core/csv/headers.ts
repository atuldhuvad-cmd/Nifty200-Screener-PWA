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

/**
 * `isin` and `nseCode` are NOT `required` here: their "missing" case is resolved jointly
 * in `mapColumns` (§9 V2 amendment — block only when BOTH are missing). Ambiguity for
 * either one still blocks individually, same as any other required field.
 */
export const FIELD_DEFINITIONS: Readonly<Record<FieldKey, FieldDefinition>> = {
  volumeNumerator: { required: true, aliases: ['consolidated end of day vol'] },
  volumeDenominator: { required: true, aliases: ['consolidated 30d average end of day vol'] },
  isin: { required: false, aliases: ['isin'] },
  nseCode: { required: false, aliases: ['nse code'] },
  providerVolumeRatio: { required: false, aliases: ['volumeratio'] },
  serialNumber: { required: false, aliases: ['sl no'] },
};

const IDENTIFIER_FIELDS: readonly ['isin', 'nseCode'] = ['isin', 'nseCode'];

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

  const identifierMissing = new Set<'isin' | 'nseCode'>();

  for (const [field, def] of Object.entries(FIELD_DEFINITIONS) as [FieldKey, FieldDefinition][]) {
    const matches = indicesWhere(keys, (k) => def.aliases.includes(k));
    const [only] = matches;
    const isIdentifier = (IDENTIFIER_FIELDS as readonly FieldKey[]).includes(field);

    if (matches.length === 1 && only !== undefined) {
      columns[field] = only;
    } else if (matches.length === 0) {
      if (isIdentifier) identifierMissing.add(field as 'isin' | 'nseCode');
      else if (def.required) errors.push({ code: 'REQUIRED_COLUMN_MISSING', field });
    } else if (def.required || isIdentifier) {
      // Ambiguity always blocks, even for the otherwise-relaxed identifier fields.
      errors.push({ code: 'REQUIRED_COLUMN_AMBIGUOUS', field, columns: matches });
    } else {
      warnings.push({ code: 'OPTIONAL_COLUMN_AMBIGUOUS', field, columns: matches });
    }
  }

  if (identifierMissing.size === 2) {
    errors.push({ code: 'IDENTIFIER_COLUMNS_BOTH_MISSING' });
  } else {
    for (const field of identifierMissing) {
      warnings.push({ code: 'IDENTIFIER_COLUMN_MISSING', field });
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
