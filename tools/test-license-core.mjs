import {
  createMachineCode,
  generateSuiteKeyPair,
  issueLicenseCode,
  verifyLicenseCode
} from '../dist-electron/license-core.js';
import { generateKeyPairSync } from 'node:crypto';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const suite = generateSuiteKeyPair('123456789');
const deviceKeys = generateKeyPairSync('x25519');
const deviceEncryptionPrivateKeyPem = deviceKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const machineCode = createMachineCode({
  suiteId: suite.suiteId,
  hardwareHash: '1'.repeat(64),
  encryptionPublicKeyPem: deviceKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
});
const username = 'acceptance-user';
const serviceSecret = 'test-service-secret-not-for-production';
const code = issueLicenseCode({
  suite,
  machineCode,
  username,
  serviceSecret,
  authorizedDays: 30
});

assert(!code.includes(machineCode), 'License code leaked the machine code as plaintext.');
assert(!code.includes(username), 'License code leaked the username as plaintext.');
assert(!code.includes(serviceSecret), 'License code leaked the service secret as plaintext.');

const valid = verifyLicenseCode({ code, suite, machineCode, username, deviceEncryptionPrivateKeyPem });
assert(valid.ok, `Expected valid license: ${valid.reason || 'unknown error'}`);
assert(valid.payload?.serviceSecret === serviceSecret, 'Verified payload lost the service secret.');

const otherDeviceKeys = generateKeyPairSync('x25519');
const otherMachineCode = createMachineCode({
  suiteId: suite.suiteId,
  hardwareHash: '2'.repeat(64),
  encryptionPublicKeyPem: otherDeviceKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
});
const wrongMachine = verifyLicenseCode({
  code,
  suite,
  machineCode: otherMachineCode,
  username,
  deviceEncryptionPrivateKeyPem: otherDeviceKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
});
assert(!wrongMachine.ok, 'Wrong machine code was not rejected.');

const wrongUsername = verifyLicenseCode({ code, suite, machineCode, username: `${username}-other`, deviceEncryptionPrivateKeyPem });
assert(!wrongUsername.ok && wrongUsername.reason === '用户名不匹配', 'Wrong username was not rejected.');

const otherSuite = generateSuiteKeyPair('987654321');
const wrongSuite = verifyLicenseCode({ code, suite: otherSuite, machineCode, username, deviceEncryptionPrivateKeyPem });
assert(!wrongSuite.ok && wrongSuite.reason === '套装 ID 不匹配', 'A different suite accepted the license.');

const expiredCode = issueLicenseCode({
  suite,
  machineCode,
  username,
  serviceSecret,
  authorizedDays: 1,
  issuedAt: Date.now() - 2 * 24 * 60 * 60 * 1000
});
const expired = verifyLicenseCode({ code: expiredCode, suite, machineCode, username, deviceEncryptionPrivateKeyPem });
assert(!expired.ok && expired.reason === '授权已过期', 'Expired license was not rejected.');

const finalCharacter = code.at(-1);
const tamperedCode = `${code.slice(0, -1)}${finalCharacter === 'A' ? 'B' : 'A'}`;
const tampered = verifyLicenseCode({ code: tamperedCode, suite, machineCode, username, deviceEncryptionPrivateKeyPem });
assert(!tampered.ok, 'Tampered license code was accepted.');

console.log('license-core: all checks passed');
