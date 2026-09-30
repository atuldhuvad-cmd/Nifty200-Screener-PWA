/** The one Google Identity Services script this app may load. Nothing loads it at startup. */
export const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

export interface LoaderScriptElement {
  src: string;
  async: boolean;
  defer: boolean;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  remove(): void;
}

/** The slice of the DOM the loader needs, so it can be tested without a browser. */
export interface LoaderDocument {
  createElement(): LoaderScriptElement;
  appendScript(element: LoaderScriptElement): void;
}

export interface GisLoaderOptions {
  document: LoaderDocument;
  timeoutMs?: number;
}

/**
 * Returns a function that loads the GIS script on demand. The first call adds one `<script>`;
 * later calls reuse it. A failed or timed-out load removes its element, so a retry starts clean.
 */
export function createGisLoader(options: GisLoaderOptions): () => Promise<void> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  let loaded = false;
  let pending: Promise<void> | null = null;

  return function load(): Promise<void> {
    if (loaded) return Promise.resolve();
    if (pending !== null) return pending;

    const script = options.document.createElement();
    pending = new Promise<void>((resolve, reject) => {
      const fail = (code: string): void => {
        clearTimeout(timer);
        script.remove();
        pending = null;
        reject(new Error(code));
      };
      const timer = setTimeout(() => {
        fail('GIS_SCRIPT_LOAD_TIMEOUT');
      }, timeoutMs);
      script.src = GIS_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        clearTimeout(timer);
        loaded = true;
        pending = null;
        resolve();
      };
      script.onerror = () => {
        fail('GIS_SCRIPT_LOAD_FAILED');
      };
      options.document.appendScript(script);
    });
    return pending;
  };
}

/** The real DOM, adapted. Only ever used from a user click. */
export function browserLoaderDocument(): LoaderDocument {
  return {
    createElement: () => document.createElement('script') as LoaderScriptElement,
    appendScript: (element) => {
      document.head.appendChild(element as unknown as HTMLScriptElement);
    },
  };
}
