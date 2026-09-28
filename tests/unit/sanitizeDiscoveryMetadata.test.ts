import { describe, expect, it } from 'vitest';
import {
  REDACTED,
  sanitizeQuarantineDiscoveryMetadata,
} from '../../src/core/storage/sanitizeDiscoveryMetadata';

describe('sanitizeQuarantineDiscoveryMetadata: known keys only', () => {
  it('passes through every known key with a valid value', () => {
    expect(
      sanitizeQuarantineDiscoveryMetadata({
        drive_file_id: '1A2b3C-validFileId_09',
        drive_app_properties: { app: 'n200-screener' },
        backup_entry_name: 'run-0042.json',
        backup_entry_index: 42,
        detection_context: 'drive_folder_scan',
      }),
    ).toEqual({
      drive_file_id: '1A2b3C-validFileId_09',
      drive_app_properties: { app: 'n200-screener' },
      backup_entry_name: 'run-0042.json',
      backup_entry_index: 42,
      detection_context: 'drive_folder_scan',
    });
  });

  it('silently drops unrecognized keys rather than rejecting the whole object', () => {
    expect(
      sanitizeQuarantineDiscoveryMetadata({
        backup_entry_name: 'run-0042.json',
        __proto__: 'ignored',
        admin: true,
        arbitrary_hostile_key: 'x'.repeat(10000),
      }),
    ).toEqual({ backup_entry_name: 'run-0042.json' });
  });

  it('returns undefined for non-object input (string, number, array, null)', () => {
    expect(sanitizeQuarantineDiscoveryMetadata('not an object')).toBeUndefined();
    expect(sanitizeQuarantineDiscoveryMetadata(42)).toBeUndefined();
    expect(sanitizeQuarantineDiscoveryMetadata(['a', 'b'])).toBeUndefined();
    expect(sanitizeQuarantineDiscoveryMetadata(null)).toBeUndefined();
    expect(sanitizeQuarantineDiscoveryMetadata(undefined)).toBeUndefined();
  });

  it('returns undefined when nothing valid survives (an object of only unknown/invalid keys)', () => {
    expect(
      sanitizeQuarantineDiscoveryMetadata({ nonsense: 1, detection_context: 'made_up_code' }),
    ).toBeUndefined();
  });
});

describe('sanitizeQuarantineDiscoveryMetadata: detection_context is a stable code, never free text', () => {
  it('accepts every declared code', () => {
    for (const code of [
      'drive_folder_scan',
      'drive_global_search',
      'backup_import_scan',
      'manual_recovery_attempt',
      'periodic_integrity_check',
      'other',
    ]) {
      expect(sanitizeQuarantineDiscoveryMetadata({ detection_context: code })).toEqual({
        detection_context: code,
      });
    }
  });

  it('drops an arbitrary free-text value instead of storing it verbatim', () => {
    expect(
      sanitizeQuarantineDiscoveryMetadata({
        detection_context: 'the user said this file looked suspicious to them',
      }),
    ).toBeUndefined();
  });
});

describe('sanitizeQuarantineDiscoveryMetadata: length limits', () => {
  it('truncates an oversized (but ordinary) drive_file_id and backup_entry_name rather than dropping them', () => {
    const longId = 'a'.repeat(50) + 'b'.repeat(250); // ordinary chars, well past the limit
    const result = sanitizeQuarantineDiscoveryMetadata({
      drive_file_id: longId,
      backup_entry_name: 'x'.repeat(1000),
    });
    expect(result?.drive_file_id?.length).toBeLessThanOrEqual(200);
    expect(result?.backup_entry_name?.length).toBeLessThanOrEqual(255);
  });

  it("caps drive_app_properties at 30 entries and 124 chars per value, matching Drive's own limits", () => {
    const hostile: Record<string, string> = {};
    for (let i = 0; i < 200; i++) hostile[`key${i}`] = 'v';
    hostile['overlong'] = 'y'.repeat(1000);

    const result = sanitizeQuarantineDiscoveryMetadata({ drive_app_properties: hostile });
    expect(Object.keys(result?.drive_app_properties ?? {}).length).toBeLessThanOrEqual(30);
    const overlongValue = result?.drive_app_properties?.['overlong'];
    expect(overlongValue === undefined || overlongValue.length <= 124).toBe(true);
  });

  it('drops an out-of-range or non-integer backup_entry_index', () => {
    expect(sanitizeQuarantineDiscoveryMetadata({ backup_entry_index: -1 })).toBeUndefined();
    expect(sanitizeQuarantineDiscoveryMetadata({ backup_entry_index: 1.5 })).toBeUndefined();
    expect(sanitizeQuarantineDiscoveryMetadata({ backup_entry_index: 50_000_000 })).toBeUndefined();
    expect(sanitizeQuarantineDiscoveryMetadata({ backup_entry_index: '42' })).toBeUndefined();
    expect(sanitizeQuarantineDiscoveryMetadata({ backup_entry_index: 0 })).toEqual({
      backup_entry_index: 0,
    });
  });
});

describe('sanitizeQuarantineDiscoveryMetadata: credential-shaped values are redacted, never persisted verbatim', () => {
  it('redacts a Bearer/Basic auth-shaped value', () => {
    expect(
      sanitizeQuarantineDiscoveryMetadata({
        backup_entry_name: 'Bearer eyJhbGciOiJIUzI1NiJ9.super-secret-payload.signature',
      }),
    ).toEqual({ backup_entry_name: REDACTED });
  });

  it('redacts a JWT-shaped value', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fw';
    expect(sanitizeQuarantineDiscoveryMetadata({ backup_entry_name: jwt })).toEqual({
      backup_entry_name: REDACTED,
    });
  });

  it('redacts a URL carrying a query string', () => {
    expect(
      sanitizeQuarantineDiscoveryMetadata({
        backup_entry_name: 'https://example.com/download?token=abcdef1234567890secret',
      }),
    ).toEqual({ backup_entry_name: REDACTED });
  });

  it('redacts a URL carrying embedded userinfo credentials', () => {
    expect(
      sanitizeQuarantineDiscoveryMetadata({
        backup_entry_name: 'https://admin:hunter2@internal.example.com/files',
      }),
    ).toEqual({ backup_entry_name: REDACTED });
  });

  it('redacts a long opaque token-like value in backup_entry_name and drive_app_properties (not their normal shape)', () => {
    const opaque = 'x'.repeat(60);
    expect(sanitizeQuarantineDiscoveryMetadata({ backup_entry_name: opaque })).toEqual({
      backup_entry_name: REDACTED,
    });
    expect(
      sanitizeQuarantineDiscoveryMetadata({ drive_app_properties: { secret: opaque } }),
    ).toEqual({ drive_app_properties: { secret: REDACTED } });
  });

  it('does NOT redact a long opaque drive_file_id — that is its normal, expected shape', () => {
    const realisticDriveId = '1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUvWxYz1234567';
    expect(sanitizeQuarantineDiscoveryMetadata({ drive_file_id: realisticDriveId })).toEqual({
      drive_file_id: realisticDriveId,
    });
  });

  it('still redacts a bearer/JWT/URL-shaped value even inside drive_file_id, despite the opaque-token allowance', () => {
    expect(
      sanitizeQuarantineDiscoveryMetadata({ drive_file_id: 'Bearer some-token-value-here' }),
    ).toEqual({ drive_file_id: REDACTED });
  });

  it('never returns the raw hostile value anywhere in the sanitized output', () => {
    const secret = 'Bearer sk-live-abcdef1234567890SECRETSECRETSECRET';
    const result = sanitizeQuarantineDiscoveryMetadata({
      drive_file_id: secret,
      backup_entry_name: secret,
      drive_app_properties: { token: secret },
    });
    expect(JSON.stringify(result)).not.toContain('sk-live-abcdef1234567890SECRETSECRETSECRET');
  });
});
