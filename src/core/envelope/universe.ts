export const RUN_UNIVERSES = [
  'Nifty 50',
  'Nifty Next 50',
  'Nifty 100',
  'Nifty 200',
  'Nifty 500',
  'Nifty Midcap 50',
  'Nifty Midcap 100',
  'Nifty Midcap 150',
  'Nifty Midcap 250',
  'Nifty Smallcap 100',
  'Nifty Smallcap 250',
  'Nifty Smallcap 500',
  'Nifty LargeMidcap 250',
  'All Stocks',
] as const satisfies readonly string[];

export type RunUniverse = string;

export const DEFAULT_RUN_UNIVERSE: RunUniverse = 'Nifty 200';

export function normalizeRunUniverse(universe: string): RunUniverse {
  return universe.trim().replace(/\s+/g, ' ');
}

export function isRunUniverseValid(universe: string): boolean {
  const normalized = normalizeRunUniverse(universe);
  return normalized.length >= 2 && normalized.length <= 80;
}

export function expectedUniverseCount(universe: RunUniverse): number | undefined {
  const normalized = normalizeRunUniverse(universe);
  const matches = [...normalized.matchAll(/\b([1-9][0-9]{0,3})\b/g)];
  const last = matches.at(-1)?.[1];
  return last === undefined ? undefined : Number(last);
}
