import assert from 'node:assert/strict';
import { normalizeComposerEnglishStyle } from '../dist-electron/translation-english-style.js';

assert.equal(normalizeComposerEnglishStyle('Yeah.'), 'Yeah');
assert.equal(normalizeComposerEnglishStyle('Are you sure?'), 'Are you sure?');
assert.equal(normalizeComposerEnglishStyle('That works — I agree; okay.'), 'That works, I agree, okay');
assert.equal(normalizeComposerEnglishStyle('well-known answer.'), 'well known answer');
console.log('translation-english-style: final period, dash, and semicolon enforcement passed');
