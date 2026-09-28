import { openDatabase, type N200Database, type OpenDatabaseOptions } from '../core/storage';

let openPromise: Promise<{ db: N200Database; singleTabWarning: boolean }> | undefined;

/** One shared connection per page load; `options` only take effect on the first call. */
export function getDatabase(
  options: OpenDatabaseOptions = {},
): Promise<{ db: N200Database; singleTabWarning: boolean }> {
  openPromise ??= openDatabase(options).then(({ db, singleTabWarning }) => ({
    db,
    singleTabWarning,
  }));
  return openPromise;
}
