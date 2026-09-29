export {
  findIdentityConflicts,
  isinIdentityKey,
  listComparisonIdentityGroups,
  nseIdentityKey,
  queryComparisonIndexByIdentity,
  rebuildComparisonIndexTx,
} from './comparisonIndex';
export type {
  ComparisonIdentityGroup,
  IdentityConflictEntry,
  IdentityConflictGroup,
} from './comparisonIndex';
export type { IngestOutcome, ParsedCandidate, RoutingDecision } from './ingest';
export { decideRouting, ingestEnvelopeBytes, parseIngestCandidate } from './ingest';
export { REDACTED, sanitizeQuarantineDiscoveryMetadata } from './sanitizeDiscoveryMetadata';
export {
  isWebLocksAvailable,
  WEB_LOCKS_UNAVAILABLE_CODE,
  WebLocksUnavailableError,
  withMigrationLock,
  withRequiredLock,
} from './locks';
export type { LockOutcome } from './locks';
export { countAtRiskRuns, requestPersistentStorage } from './persistence';
export type { PersistPromptResult } from './persistence';
export {
  isEnvelopeV1,
  isEnvelopeV2,
  isRunAtRisk,
  isRunOpenable,
  isSupportedEnvelope,
} from './runStatus';
export {
  applyTransition,
  commitNewRun,
  findRunsByExactSourceHashSet,
  findRunsByOriginalFileHash,
  findRunsBySourceFileHash,
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
export { initialSyncRecord, QUARANTINE_DETECTION_CONTEXTS } from './types';
export type {
  ComparisonIdentityRecord,
  QuarantineDetectionContext,
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
