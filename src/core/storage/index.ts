export {
  findIdentityConflicts,
  isinIdentityKey,
  nseIdentityKey,
  queryComparisonIndexByIdentity,
  rebuildComparisonIndexTx,
} from './comparisonIndex';
export type { IdentityConflictEntry, IdentityConflictGroup } from './comparisonIndex';
export type { IngestOutcome } from './ingest';
export { ingestEnvelopeBytes } from './ingest';
export { withMigrationLock } from './locks';
export type { LockOutcome } from './locks';
export { countAtRiskRuns, requestPersistentStorage } from './persistence';
export type { PersistPromptResult } from './persistence';
export {
  applyTransition,
  commitNewRun,
  findRunsByOriginalFileHash,
  getAllRuns,
  getRun,
  rebuildComparisonIndexForRun,
} from './runs';
export type { ApplyTransitionResult, CommitNewRunResult } from './runs';
export {
  COMPARISON_BY_IDENTITY_KEY,
  COMPARISON_BY_RUN_ID,
  DB_NAME,
  DB_VERSION,
  openDatabase,
  RUNS_BY_ORIGINAL_FILE_SHA256,
  STORE,
} from './schema';
export type { N200Database, N200DBSchema, OpenDatabaseOptions, OpenDatabaseResult } from './schema';
export { SYNC_STATES, transition } from './syncState';
export type { SyncEvent, SyncEventType, TransitionResult } from './syncState';
export { initialSyncRecord } from './types';
export type {
  ComparisonIdentityRecord,
  QuarantineDiscoveryMetadata,
  QuarantineItemRecord,
  QuarantineSource,
  RunRecord,
  RunVariantRecord,
  SyncDiagnostics,
  SyncRecord,
  SyncState,
  UnsupportedSchemaEnvelope,
  VariantSource,
} from './types';
