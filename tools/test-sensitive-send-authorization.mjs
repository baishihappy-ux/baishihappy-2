import assert from 'node:assert/strict';
import {
  SensitiveSendAuthorizationStore,
  sensitiveSendAuthorizationTtlMs
} from '../dist-electron/sensitive-send-authorization.js';

const baseRequest = {
  profileId: '00000000-0000-4000-8000-000000000001',
  platform: 'signal',
  conversationSignature: 'Alice::conversation-fingerprint',
  text: '0012 345678',
  network: undefined
};

const store = new SensitiveSendAuthorizationStore();
const issuedAt = 1_000_000;
const first = store.issue(baseRequest, 'numeric-account', undefined, issuedAt);
assert.equal(Buffer.from(first.token, 'base64url').length, 32);
assert.equal(first.expiresAt, issuedAt + sensitiveSendAuthorizationTtlMs);
assert.equal(store.authorize({ ...baseRequest, token: first.token }, issuedAt + 1).ok, true);
assert.equal(store.authorize({ ...baseRequest, token: first.token }, issuedAt + 2).ok, false);

const mismatch = store.issue(baseRequest, 'numeric-account', undefined, issuedAt);
assert.equal(store.authorize({ ...baseRequest, text: '0012 345679', token: mismatch.token }, issuedAt + 1).ok, false);
assert.equal(store.authorize({ ...baseRequest, token: mismatch.token }, issuedAt + 2).ok, false);

const expired = store.issue(baseRequest, 'numeric-account', undefined, issuedAt);
assert.equal(store.authorize({ ...baseRequest, token: expired.token }, issuedAt + sensitiveSendAuthorizationTtlMs).ok, false);

const walletRequest = { ...baseRequest, text: `0x${'12'.repeat(20)}`, network: 'ERC20' };
const wallet = store.issue(walletRequest, 'usdt-wallet', 'ERC20', issuedAt);
assert.equal(store.authorize({ ...walletRequest, network: 'BEP20', token: wallet.token }, issuedAt + 1).ok, false);

console.log('Sensitive send authorization one-use and binding checks passed.');
