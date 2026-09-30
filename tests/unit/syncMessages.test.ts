import { describe, expect, it } from 'vitest';
import { describeMessage, describeOutcome, STATUS_LABELS } from '../../src/lib/syncMessages';

describe('plain-language sync messages', () => {
  it('has a text label for every account state (status is never colour alone)', () => {
    expect(STATUS_LABELS).toEqual({
      disconnected: 'Disconnected',
      authorizing: 'Connecting…',
      connected: 'Connected',
      reconnect_required: 'Reconnect required',
    });
  });

  it.each([
    'NOT_CONFIGURED',
    'NOT_CONNECTED',
    'ALREADY_RUNNING',
    'CONNECTED',
    'CONNECT_CANCELLED',
    'POPUP_BLOCKED',
    'ACCESS_DENIED',
    'SCOPE_MISSING',
    'SCRIPT_FAILED',
    'CONNECT_ERROR',
    'DISCONNECTED',
    'DISCONNECTED_UNCONFIRMED',
    'FOLDER_CHOSEN',
    'RESTORED',
    'RESTORE_FAILED',
    'KEPT_LOCAL_ONLY',
  ])('describes %s with non-empty text that never echoes a code', (code) => {
    const text = describeMessage(code);
    expect(text.length).toBeGreaterThan(10);
    expect(text).not.toContain(code);
  });

  it('describes every sync outcome, and a failure includes only its stable code', () => {
    expect(describeOutcome('blocked_account', null)).toMatch(/different/i);
    expect(describeOutcome('reconnect_required', null)).toMatch(/reconnect/i);
    expect(describeOutcome('locks_unavailable', null)).toMatch(/single tab|one tab/i);
    expect(describeOutcome('busy', null)).toMatch(/another tab/i);
    expect(describeOutcome('failed', 'DRIVE_SERVER_ERROR:backendError')).toContain(
      'DRIVE_SERVER_ERROR:backendError',
    );
    expect(describeOutcome('ok', null)).toMatch(/finished/i);
    expect(describeOutcome('cancelled', null).length).toBeGreaterThan(5);
  });

  it('an unknown code still yields a safe generic sentence', () => {
    expect(describeMessage('SOMETHING_NEW')).toMatch(/something/i);
  });
});
