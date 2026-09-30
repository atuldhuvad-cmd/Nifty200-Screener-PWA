import type { RunEnvelopeV1, RunEnvelopeV2 } from '../envelope/types';

/**
 * Private Drive `appProperties` tags. They exist so the app can find its own folder and run files
 * (even after the folder is renamed or a file is moved). They are discovery HINTS only: the
 * authoritative run id, schema version and hashes always come from the validated envelope, and a
 * disagreement quarantines the file. Keys and values stay well under Drive's 124-byte limit and
 * carry no filename, stock data or personal information.
 */
export const PROP = {
  app: 'n200_app',
  kind: 'n200_kind',
  run: 'n200_run',
  schema: 'n200_schema',
  envelopeSha: 'n200_env',
  fileSha: 'n200_file',
} as const;

export const APP_ID = 'n200-screener';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const FOLDER_NAME = 'Nifty 200 Screener data';

export function folderProperties(): Record<string, string> {
  return { [PROP.app]: APP_ID, [PROP.kind]: 'folder' };
}

export function runProperties(envelope: RunEnvelopeV1 | RunEnvelopeV2): Record<string, string> {
  const props: Record<string, string> = {
    [PROP.app]: APP_ID,
    [PROP.kind]: 'run',
    [PROP.run]: envelope.run_id,
    [PROP.schema]: envelope.schema_version,
    [PROP.envelopeSha]: envelope.envelope_sha256,
  };
  if (envelope.schema_version === '1') props[PROP.fileSha] = envelope.original_file_sha256;
  return props;
}

const hasProp = (key: string, value: string): string =>
  `appProperties has { key='${key}' and value='${value}' }`;

/** Search for every application folder, wherever it now lives or whatever it is now called. */
export function folderQuery(): string {
  return [
    'trashed = false',
    `mimeType = '${FOLDER_MIME}'`,
    hasProp(PROP.app, APP_ID),
    hasProp(PROP.kind, 'folder'),
  ].join(' and ');
}

/** Search for every application run file, regardless of parent folder. */
export function runFileQuery(): string {
  return ['trashed = false', hasProp(PROP.app, APP_ID), hasProp(PROP.kind, 'run')].join(' and ');
}

/**
 * Whether the discovery tags agree with the file's own validated content on the file's IDENTITY:
 * which run it is and which schema it claims. The envelope-hash tag is deliberately NOT part of
 * this check: a file edited outside the app keeps its old hash tag, and that divergence must
 * surface as a conflict (both copies preserved), not be discarded as a tag mismatch.
 */
export function propertiesMatchEnvelope(
  props: Record<string, string> | undefined,
  envelope: { run_id: string; schema_version: string },
): boolean {
  if (props === undefined) return false;
  return props[PROP.run] === envelope.run_id && props[PROP.schema] === envelope.schema_version;
}
