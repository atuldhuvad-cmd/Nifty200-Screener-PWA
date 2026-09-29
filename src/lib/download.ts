import type { DownloadPayload } from '../core/review';

/** Saves `payload` through a temporary object URL and a synthetic `<a download>` click. Nothing
 * is rendered or interpreted: the bytes go to the user's disk exactly as given. */
export function downloadPayload(payload: DownloadPayload): void {
  const blob = new Blob([payload.bytes as BlobPart], { type: payload.mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = payload.filename;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
