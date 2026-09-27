import type { RunEnvelopeV1 } from '../envelope/types';

/**
 * The complete declared sync-state set from the brief's "Local storage" section — no state is
 * ever introduced outside this list, and nothing assigns a state except `transition()`.
 */
export const SYNC_STATES = [
  'pending',
  'syncing',
  'synced',
  'error',
  'remote_missing',
  'local_only',
  'conflict',
  'quarantined',
  'unsupported_schema',
] as const;
export type SyncState = (typeof SYNC_STATES)[number];

export interface SyncDiagnostics {
  last_attempt_at: string | null;
  last_success_at: string | null;
  attempt_count: number;
  error_code: string | null;
  retryable: boolean | null;
}

export interface SyncRecord {
  state: SyncState;
  /**
   * The state to fall back to if the current `syncing` attempt is cancelled or times out
   * ("A user cancellation restores the run to its previous stable state" — the brief's two
   * worked examples, pending and synced, are both instances of this general rule). Set when
   * entering `syncing`; cleared (null) in every other state.
   */
  prior_stable_state: SyncState | null;
  diagnostics: SyncDiagnostics;
}

export function initialSyncRecord(state: SyncState = 'pending'): SyncRecord {
  return {
    state,
    prior_stable_state: null,
    diagnostics: {
      last_attempt_at: null,
      last_success_at: null,
      attempt_count: 0,
      error_code: null,
      retryable: null,
    },
  };
}

/**
 * An envelope whose `schema_version` this app does not recognize. Preserved opaquely — never
 * forced through the v1 schema, never interpreted (brief: "unsupported_schema").
 */
export interface UnsupportedSchemaEnvelope {
  run_id: string;
  schema_version: string;
  [key: string]: unknown;
}

export interface RunRecord {
  run_id: string;
  envelope: RunEnvelopeV1 | UnsupportedSchemaEnvelope;
  sync: SyncRecord;
}

export type VariantSource = 'remote' | 'backup_import' | 'manual_recovery';

export interface RunVariantRecord {
  run_id: string;
  envelope_sha256: string;
  envelope: RunEnvelopeV1;
  source: VariantSource;
  discovered_at: string;
}

export type QuarantineSource = 'drive' | 'backup_import' | 'local_import';

export interface QuarantineItemRecord {
  quarantine_id: string;
  original_bytes: Uint8Array;
  source: QuarantineSource;
  observed_sha256: string;
  validation_errors: string[];
  discovered_at: string;
}

/**
 * Derived, disposable index for cross-run stock comparison. Rebuildable at any time from
 * validated envelopes (Engineering Standards: "Derived indexes ... must never become the sole
 * copy of any information") — never stored inside a run envelope itself.
 */
export interface ComparisonIdentityRecord {
  id?: number;
  run_id: string;
  row_index: number;
  match_method: 'isin' | 'nse_code_provisional';
  /** `isin:<normalized_isin>` or `nse:<normalized_nse_code>` — namespaced so the two never collide. */
  identity_key: string;
}
