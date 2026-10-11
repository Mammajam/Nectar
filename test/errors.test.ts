import { describe, expect, it } from 'vitest';
import { BeeApiError } from '../src/bee/client.js';
import { explainError } from '../src/util/errors.js';

const named = (name: string, message = 'x') => Object.assign(new Error(message), { name });

describe('explainError', () => {
  it('gives actionable Bee messages', () => {
    expect(explainError(new BeeApiError(401, 'GET', '/v1/me', ''))).toMatch(/bee login/);
    expect(explainError(new BeeApiError(503, 'GET', '/v1/me', ''))).toMatch(/server error/);
  });
  it('gives actionable AWS messages', () => {
    expect(explainError(named('AccessDeniedException'))).toMatch(/use-case form/);
    expect(explainError(named('CredentialsProviderError'))).toMatch(/aws configure/);
    expect(explainError(named('ValidationException', 'The provided model identifier is invalid'))).toMatch(/NECTAR_MODEL_ID/);
  });
  it('explains missing CLI and falls back to the message', () => {
    expect(explainError(Object.assign(new Error('spawn bee ENOENT'), { code: 'ENOENT' }))).toMatch(/npm i -g @beeai\/cli/);
    expect(explainError(new Error('plain'))).toBe('plain');
    expect(explainError('text')).toBe('text');
  });
});
