import Big from 'big.js';
import { parseNumericCell, type NumericDetail } from './numeric';

export const VOLUME_RATIO_METRIC_VERSION = 'volume_ratio_v1';
export const VOLUME_RATIO_SCALE = 3;

export type VolumeRatioReason =
  | 'MISSING_NUMERATOR'
  | 'MISSING_DENOMINATOR'
  | 'INVALID_NUMERATOR'
  | 'INVALID_DENOMINATOR'
  | 'NEGATIVE_NUMERATOR'
  | 'NON_POSITIVE_DENOMINATOR';

export type VolumeRatioMetric =
  | {
      status: 'valid';
      value: string;
      scale: typeof VOLUME_RATIO_SCALE;
      metric_version: typeof VOLUME_RATIO_METRIC_VERSION;
    }
  | {
      status: 'invalid';
      value: null;
      reason: VolumeRatioReason;
      detail?: NumericDetail;
      metric_version: typeof VOLUME_RATIO_METRIC_VERSION;
    };

// Isolated constructors so rounding settings never leak to or from other Big users.
const Scale3 = Big();
Scale3.DP = VOLUME_RATIO_SCALE;
Scale3.RM = Big.roundHalfUp;

const Scale2 = Big();
Scale2.DP = 2;
Scale2.RM = Big.roundHalfUp;

function invalid(reason: VolumeRatioReason, detail?: NumericDetail): VolumeRatioMetric {
  const metric: VolumeRatioMetric = {
    status: 'invalid',
    value: null,
    reason,
    metric_version: VOLUME_RATIO_METRIC_VERSION,
  };
  if (detail !== undefined) metric.detail = detail;
  return metric;
}

/**
 * volume_ratio_v1 = Consolidated end of day Vol ÷ Consolidated 30D average end of day Vol,
 * ROUND_HALF_UP at scale 3. Check order: numerator syntax, denominator syntax,
 * numerator sign, denominator sign.
 */
export function computeVolumeRatio(
  numeratorRaw: string,
  denominatorRaw: string,
): VolumeRatioMetric {
  const n = parseNumericCell(numeratorRaw);
  if (n.kind === 'missing') return invalid('MISSING_NUMERATOR');
  if (n.kind === 'invalid') return invalid('INVALID_NUMERATOR', n.detail);

  const d = parseNumericCell(denominatorRaw);
  if (d.kind === 'missing') return invalid('MISSING_DENOMINATOR');
  if (d.kind === 'invalid') return invalid('INVALID_DENOMINATOR', d.detail);

  if (n.isNegative) return invalid('NEGATIVE_NUMERATOR');
  if (d.isZero || d.isNegative) return invalid('NON_POSITIVE_DENOMINATOR');

  const value = n.isZero ? '0.000' : Scale3(n.text).div(Scale3(d.text)).toFixed(VOLUME_RATIO_SCALE);
  return {
    status: 'valid',
    value,
    scale: VOLUME_RATIO_SCALE,
    metric_version: VOLUME_RATIO_METRIC_VERSION,
  };
}

/**
 * The exact quotient rounded HALF_UP to 2 dp, for the S2 provider comparison only.
 * Rounded from the exact quotient, not from the 3 dp value, to avoid double rounding.
 */
export function volumeRatioAtScale2(numeratorRaw: string, denominatorRaw: string): Big | null {
  const n = parseNumericCell(numeratorRaw);
  const d = parseNumericCell(denominatorRaw);
  if (n.kind !== 'valid' || d.kind !== 'valid' || n.isNegative || d.isZero || d.isNegative) {
    return null;
  }
  return Scale2(n.text).div(Scale2(d.text));
}
