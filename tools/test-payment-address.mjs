import assert from 'node:assert/strict';
import { base58, createBase58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  inspectSensitiveSendText,
  isAllowedWalletNetwork,
  sensitiveNumericMaxDigits,
  sensitiveNumericMinDigits
} from '../dist-electron/payment-address.js';

const numeric = inspectSensitiveSendText('0012 345678');
assert.equal(numeric.valid, true);
assert.equal(numeric.kind, 'numeric-account');
assert.equal(inspectSensitiveSendText(' 00123456').valid, false);
assert.equal(inspectSensitiveSendText('1'.repeat(sensitiveNumericMinDigits - 1)).candidate, false);
assert.equal(inspectSensitiveSendText('1'.repeat(sensitiveNumericMaxDigits + 1)).valid, false);

const evm = inspectSensitiveSendText(`0x${'12'.repeat(20)}`);
assert.equal(evm.valid, true);
assert.deepEqual(evm.networks, ['ERC20', 'BEP20']);
assert.equal(isAllowedWalletNetwork(evm, 'ERC20'), true);
assert.equal(isAllowedWalletNetwork(evm, 'TRC20'), false);
assert.equal(inspectSensitiveSendText(`0x${'12'.repeat(19)}`).valid, false);
assert.equal(inspectSensitiveSendText('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed').valid, true);
assert.equal(inspectSensitiveSendText('0x5aaeb6053F3E94C9b9A09f33669435E7Ef1BeAed').valid, false);

const tronPayload = Uint8Array.from([0x41, ...new Uint8Array(20).fill(7)]);
const tronAddress = createBase58check(sha256).encode(tronPayload);
const tron = inspectSensitiveSendText(tronAddress);
assert.equal(tron.valid, true);
assert.deepEqual(tron.networks, ['TRC20']);
const badTron = `${tronAddress.slice(0, -1)}${tronAddress.endsWith('1') ? '2' : '1'}`;
assert.equal(inspectSensitiveSendText(badTron).valid, false);
assert.equal(inspectSensitiveSendText(`T${'0'.repeat(33)}`).valid, false);

const solanaAddress = base58.encode(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
const solana = inspectSensitiveSendText(solanaAddress);
assert.equal(solana.valid, true);
assert.deepEqual(solana.networks, ['Solana']);
assert.equal(inspectSensitiveSendText(`O${'1'.repeat(31)}`).valid, false);

assert.deepEqual(inspectSensitiveSendText('ordinary English message'), { candidate: false, valid: false });

console.log('Sensitive payment account and wallet address checks passed.');
