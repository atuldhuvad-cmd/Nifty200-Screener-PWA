export type IsinValidation = 'valid' | 'missing' | 'invalid_structure' | 'invalid_check_digit';
export type NseCodeValidation = 'valid' | 'missing' | 'invalid_characters';
export type MatchMethod = 'isin' | 'nse_code_provisional';

export type IdentityWarningCode =
  | 'ISIN_MISSING'
  | 'ISIN_INVALID_STRUCTURE'
  | 'ISIN_INVALID_CHECK_DIGIT'
  | 'ISIN_NORMALIZED'
  | 'NSE_CODE_MISSING'
  | 'NSE_CODE_INVALID_CHARACTERS'
  | 'NSE_CODE_NORMALIZED'
  | 'EXCLUDED_FROM_COMPARISON';

export interface StockIdentity {
  raw_isin: string;
  normalized_isin: string | null;
  isin_validation: IsinValidation;
  raw_nse_code: string;
  normalized_nse_code: string | null;
  nse_code_validation: NseCodeValidation;
  /** null: neither identifier is usable, so the row is excluded from longitudinal comparison. */
  match_method: MatchMethod | null;
  identity_warnings: IdentityWarningCode[];
}

const ISIN_STRUCTURE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const NSE_CODE_CHARS = /^[A-Z0-9&-]+$/;

function normalizeIdentifier(raw: string): string {
  return raw.replace(/^[ \t\u00A0]+|[ \t\u00A0]+$/g, '').replace(/[a-z]/g, (c) => c.toUpperCase());
}

/** ISO 6166: letters → 10..35, then Luhn over the expanded digit string. */
export function isinCheckDigitValid(isin: string): boolean {
  if (!ISIN_STRUCTURE.test(isin)) return false;
  let digits = '';
  for (const ch of isin.slice(0, 11)) digits += ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return (10 - (sum % 10)) % 10 === Number(isin[11]);
}

export function validateIsin(normalized: string): IsinValidation {
  if (normalized === '') return 'missing';
  if (!ISIN_STRUCTURE.test(normalized)) return 'invalid_structure';
  return isinCheckDigitValid(normalized) ? 'valid' : 'invalid_check_digit';
}

export function validateNseCode(normalized: string): NseCodeValidation {
  if (normalized === '') return 'missing';
  return NSE_CODE_CHARS.test(normalized) ? 'valid' : 'invalid_characters';
}

export function buildStockIdentity(rawIsin: string, rawNseCode: string): StockIdentity {
  const isin = normalizeIdentifier(rawIsin);
  const nse = normalizeIdentifier(rawNseCode);
  const isinValidation = validateIsin(isin);
  const nseValidation = validateNseCode(nse);
  const warnings: IdentityWarningCode[] = [];

  if (isinValidation === 'missing') warnings.push('ISIN_MISSING');
  if (isinValidation === 'invalid_structure') warnings.push('ISIN_INVALID_STRUCTURE');
  if (isinValidation === 'invalid_check_digit') warnings.push('ISIN_INVALID_CHECK_DIGIT');
  if (isin !== '' && isin !== rawIsin) warnings.push('ISIN_NORMALIZED');
  if (nseValidation === 'missing') warnings.push('NSE_CODE_MISSING');
  if (nseValidation === 'invalid_characters') warnings.push('NSE_CODE_INVALID_CHARACTERS');
  if (nse !== '' && nse !== rawNseCode) warnings.push('NSE_CODE_NORMALIZED');

  const matchMethod: MatchMethod | null =
    isinValidation === 'valid' ? 'isin' : nseValidation === 'valid' ? 'nse_code_provisional' : null;
  if (matchMethod === null) warnings.push('EXCLUDED_FROM_COMPARISON');

  return {
    raw_isin: rawIsin,
    normalized_isin: isin === '' ? null : isin,
    isin_validation: isinValidation,
    raw_nse_code: rawNseCode,
    normalized_nse_code: nse === '' ? null : nse,
    nse_code_validation: nseValidation,
    match_method: matchMethod,
    identity_warnings: warnings,
  };
}
