import { base58, createBase58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

export type SensitiveSendKind = 'numeric-account' | 'usdt-wallet';
export type WalletNetwork = 'TRC20' | 'ERC20' | 'BEP20' | 'Solana';

export type SensitiveSendInspection = {
  candidate: boolean;
  valid: boolean;
  kind?: SensitiveSendKind;
  networks?: WalletNetwork[];
  reason?: string;
};

export const sensitiveNumericMinDigits = 6;
export const sensitiveNumericMaxDigits = 34;

const tronBase58Check = createBase58check(sha256);
const base58Alphabet = /^[1-9A-HJ-NP-Za-km-z]+$/;

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function isValidEvmChecksum(address: string) {
  const body = address.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
  const lower = body.toLowerCase();
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(lower)));
  for (let index = 0; index < lower.length; index += 1) {
    const expected = Number.parseInt(hash[index], 16) >= 8 ? lower[index].toUpperCase() : lower[index];
    if (body[index] !== expected) return false;
  }
  return true;
}

function inspectNumericAccount(text: string): SensitiveSendInspection | null {
  if (!/^[0-9 ]+$/.test(text)) return null;
  const digitCount = text.replace(/ /g, '').length;
  if (digitCount < sensitiveNumericMinDigits || digitCount > sensitiveNumericMaxDigits) return null;
  if (text !== text.trim()) {
    return { candidate: true, valid: false, kind: 'numeric-account', reason: '账号首尾不能包含空格' };
  }
  return { candidate: true, valid: true, kind: 'numeric-account', networks: [] };
}

function inspectEvmAddress(text: string): SensitiveSendInspection | null {
  if (!/^0x/i.test(text)) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(text)) {
    return { candidate: true, valid: false, kind: 'usdt-wallet', reason: 'EVM 地址格式或长度无效' };
  }
  if (!isValidEvmChecksum(text)) {
    return { candidate: true, valid: false, kind: 'usdt-wallet', reason: 'EVM 地址大小写校验失败' };
  }
  return { candidate: true, valid: true, kind: 'usdt-wallet', networks: ['ERC20', 'BEP20'] };
}

function inspectTronAddress(text: string): SensitiveSendInspection | null {
  if (!text.startsWith('T') || text.length !== 34 || !/^[0-9A-Za-z]+$/.test(text)) return null;
  if (!base58Alphabet.test(text)) {
    return { candidate: true, valid: false, kind: 'usdt-wallet', reason: 'TRC20 地址包含无效字符' };
  }
  try {
    const decoded = tronBase58Check.decode(text);
    if (decoded.length === 21 && decoded[0] === 0x41) {
      return { candidate: true, valid: true, kind: 'usdt-wallet', networks: ['TRC20'] };
    }
  } catch {
    // The shape is address-like, so report it as invalid instead of allowing an unsafe send.
  }
  return { candidate: true, valid: false, kind: 'usdt-wallet', reason: 'TRC20 地址校验失败' };
}

function inspectSolanaAddress(text: string): SensitiveSendInspection | null {
  if (text.length < 32 || text.length > 44 || !/^[0-9A-Za-z]+$/.test(text)) return null;
  if (!base58Alphabet.test(text)) {
    return { candidate: true, valid: false, kind: 'usdt-wallet', reason: 'Solana 地址包含无效字符' };
  }
  try {
    if (base58.decode(text).length === 32) {
      return { candidate: true, valid: true, kind: 'usdt-wallet', networks: ['Solana'] };
    }
  } catch {
    // Fall through to an explicit validation failure.
  }
  return { candidate: true, valid: false, kind: 'usdt-wallet', reason: 'Solana 地址校验失败' };
}

export function inspectSensitiveSendText(text: string): SensitiveSendInspection {
  if (!text || text.length > 256 || text.includes('\r') || text.includes('\n')) return { candidate: false, valid: false };
  return inspectNumericAccount(text)
    || inspectEvmAddress(text)
    || inspectTronAddress(text)
    || inspectSolanaAddress(text)
    || { candidate: false, valid: false };
}

export function isAllowedWalletNetwork(
  inspection: SensitiveSendInspection,
  network: WalletNetwork | undefined
) {
  if (inspection.kind !== 'usdt-wallet' || !inspection.networks?.length || !network) return false;
  return inspection.networks.includes(network);
}
