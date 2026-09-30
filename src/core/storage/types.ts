import type { RunEnvelopeV1, RunEnvelopeV2 } from '../envelope/types';

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
  /**
   * Explicit, current-moment fact: is there a Drive copy verified to match this run's content
   * right now? (Bugbot P2-3 — not inferred from `last_success_at`, which only says a sync ever
   * succeeded, not whether that copy is still valid.) True only immediately after
   * `SYNC_SUCCEEDED`; a later `REMOTE_MISSING_DETECTED` or a divergent-variant conflict clears
   * it back to false, even though the run did once sync successfully.
   */
  has_verified_remote_copy: boolean;
}

/**
 * Device-specific Drive bookkeeping for one run. It lives on the run's sync record (never in the
 * immutable envelope, never in a backup), and holds no token, no session URL and no email.
 */
export interface DriveMetadata {
  /** The pre-generated Drive file ID, persisted BEFORE the first upload attempt. */
  file_id: string;
  folder_id: string | null;
  /** Drive's `version` and `md5Checksum` as of the last verified upload or download. */
  version: string | null;
  md5_checksum: string | null;
}

export interface SyncRecord {
  state: SyncState;
  /** Absent until the run has been assigned a Drive file ID. */
  drive?: DriveMetadata;
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
      has_verified_remote_copy: false,
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
  envelope: RunEnvelopeV1 | RunEnvelopeV2 | UnsupportedSchemaEnvelope;
  sync: SyncRecord;
}

/** A single-leader lease so only one tab drains the sync queue (no nested Web Locks). */
export interface SyncLease {
  holder_id: string;
  expires_at_ms: number;
}

/**
 * The one sync profile for this device. Holds only the opaque Drive `permissionId` the profile
 * is bound to, folder identifiers, and the leader lease. Never an email, token or session URL.
 */
export interface SyncProfileRecord {
  profile_id: 'default';
  bound_permission_id: string | null;
  active_folder_id: string | null;
  known_folder_ids: string[];
  /** A pre-generated folder ID, persisted before the folder is first created. */
  pending_folder_id: string | null;
  lease: SyncLease | null;
  created_at: string;
  updated_at: string;
}

export type VariantSource = 'remote' | 'backup_import' | 'manual_recovery';

export interface RunVariantRecord {
  run_id: string;
  envelope_sha256: string;
  /** A divergent copy of either a v1 or v2 canonical run (Step 6: backup import can produce a
   * v2/multipart variant, same as a v1 one — this was previously typed v1-only, a pre-existing
   * gap never exercised because nothing ingested a v2 envelope through this path before). */
  envelope: RunEnvelopeV1 | RunEnvelopeV2;
  source: VariantSource;
  discovered_at: string;
}

export type QuarantineSource = 'drive' | 'backup_import' | 'local_import';

/**
 * Structured provenance for a quarantined item, recorded for operator diagnosis only.
 * (Bugbot P2-5.) Every field is **non-authoritative discovery metadata** — exactly like the
 * brief's treatment of Drive `appProperties`: "discovery hints only, never trusted content."
 * Nothing here is ever used to route, validate, or re-classify the item; it is preserved
 * purely so a human reviewing `quarantine_items` can tell where a bad item came from.
 */
/**
 * Stable codes, not free text (security review P2-B) — a free-text field would be an unbounded
 * channel for whatever a hostile or buggy caller wants to store verbatim.
 */
export const QUARANTINE_DETECTION_CONTEXTS = [
  'drive_folder_scan',
  'drive_global_search',
  'backup_import_scan',
  'manual_recovery_attempt',
  'periodic_integrity_check',
  'other',
] as const;
export type QuarantineDetectionContext = (typeof QUARANTINE_DETECTION_CONTEXTS)[number];

/**
 * Structured, non-authoritative discovery metadata, bounded at the storage boundary by
 * `sanitizeQuarantineDiscoveryMetadata` (security review P2-B) before ever reaching
 * `QuarantineItemRecord`: unknown keys are dropped, known string fields are length-limited,
 * and any value that looks credential-shaped (a bearer/basic auth string, a JWT, a URL with a
 * query string or embedded userinfo, or — outside `drive_file_id`, whose normal shape is a
 * long opaque token — a long opaque token) is replaced with `'[REDACTED]'` rather than stored.
 */
export interface QuarantineDiscoveryMetadata {
  /** Drive file id, when `source === 'drive'`. Never trusted; see brief on appProperties. */
  drive_file_id?: string;
  /** The file's own (also-untrusted) appProperties tags, when available. */
  drive_app_properties?: Record<string, string>;
  /** The backup archive/manifest entry's own name, when `source === 'backup_import'`. */
  backup_entry_name?: string;
  /** The entry's position within the backup manifest's ordered run-ID list. */
  backup_entry_index?: number;
  /** A stable code for how/where this item was found — never free text. */
  detection_context?: QuarantineDetectionContext;
}

export interface QuarantineItemRecord {
  quarantine_id: string;
  original_bytes: Uint8Array;
  source: QuarantineSource;
  observed_sha256: string;
  validation_errors: string[];
  discovered_at: string;
  discovery_metadata?: QuarantineDiscoveryMetadata;
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
  /**
   * Both identifiers are stored on every row (Bugbot P2-2), regardless of which one
   * `match_method`/`identity_key` are keyed on, so a "same NSE Code, different ISIN" conflict
   * (brief: "conflict; do not auto-merge, surface for review") can be detected across rows
   * without re-deriving identity from the envelope each time. ISIN remains primary for
   * matching — these fields are for conflict detection only.
   */
  normalized_isin: string | null;
  normalized_nse_code: string | null;
}
