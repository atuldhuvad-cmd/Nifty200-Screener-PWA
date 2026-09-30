import { describe, expect, it } from 'vitest';
import {
  GIS_SCRIPT_URL,
  createGisLoader,
  type LoaderDocument,
  type LoaderScriptElement,
} from '../../src/core/sync/gisLoader';

interface FakeScript extends LoaderScriptElement {
  removed: boolean;
}

function fakeDocument() {
  const appended: FakeScript[] = [];
  const doc: LoaderDocument = {
    createElement: () => {
      const script: FakeScript = {
        src: '',
        async: false,
        defer: false,
        onload: null,
        onerror: null,
        removed: false,
        remove() {
          this.removed = true;
        },
      };
      return script;
    },
    appendScript(script) {
      appended.push(script as FakeScript);
    },
  };
  return { doc, appended };
}

describe('loadGisScript', () => {
  it('uses the exact approved Google Identity Services URL', () => {
    expect(GIS_SCRIPT_URL).toBe('https://accounts.google.com/gsi/client');
  });

  it('adds nothing to the page until it is called', () => {
    const { appended } = fakeDocument();
    expect(appended).toHaveLength(0);
  });

  it('appends one async script for the approved URL and resolves on load; repeat calls reuse it', async () => {
    const { doc, appended } = fakeDocument();
    const load = createGisLoader({ document: doc, timeoutMs: 1000 });
    const first = load();
    const second = load();
    expect(appended).toHaveLength(1);
    expect(appended[0]?.src).toBe(GIS_SCRIPT_URL);
    expect(appended[0]?.async).toBe(true);
    appended[0]?.onload?.();
    await Promise.all([first, second]);
    await load();
    expect(appended).toHaveLength(1);
  });

  it('rejects on a load error, removes the failed element, and appends a fresh one on retry', async () => {
    const { doc, appended } = fakeDocument();
    const load = createGisLoader({ document: doc, timeoutMs: 1000 });
    const failing = load();
    appended[0]?.onerror?.();
    await expect(failing).rejects.toThrow(/GIS_SCRIPT_LOAD_FAILED/);
    expect(appended[0]?.removed).toBe(true);
    const retry = load();
    expect(appended).toHaveLength(2);
    appended[1]?.onload?.();
    await retry;
  });

  it('rejects if the script never loads within the timeout', async () => {
    const { doc, appended } = fakeDocument();
    const load = createGisLoader({ document: doc, timeoutMs: 20 });
    await expect(load()).rejects.toThrow(/GIS_SCRIPT_LOAD_TIMEOUT/);
    expect(appended[0]?.removed).toBe(true);
  });
});
