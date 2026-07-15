import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  restoreComposerEnglishLayout,
  sanitizeComposerEnglishTranslation
} from '../dist-electron/shared.js';

const source = '你确定吗？';
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const main = fs.readFileSync(path.join(projectRoot, 'electron', 'main.ts'), 'utf8');

assert.equal(
  sanitizeComposerEnglishTranslation('Are you sure？'),
  'Are you sure?',
  'the Chinese full-width question mark must become an English question mark'
);
assert.equal(
  restoreComposerEnglishLayout(source, 'Are you sure'),
  'Are you sure?',
  'a Chinese question must not lose its question mark in the English result'
);
assert.equal(
  restoreComposerEnglishLayout(source, 'Are you sure?'),
  'Are you sure?',
  'an existing English question mark must not be duplicated'
);
assert.equal(
  restoreComposerEnglishLayout(source, 'Are you sure??'),
  'Are you sure?',
  'the English result must contain exactly one trailing question mark'
);

assert.equal(
  sanitizeComposerEnglishTranslation('Visit https://example.com/a-b. Product X-2; okay'),
  'Visit https://example.com/a-b. Product X-2; okay',
  'URLs, product models, periods, hyphens, and semicolons must not be stripped'
);
assert.doesNotMatch(main, /const\s+\w+SystemPrompt\s*=\s*`/);
assert.match(main, /loadTranslationPrompts\(deepseekApiKey\)/);
assert.match(main, /translationPrompts\.chineseToEnglish/);
assert.match(main, /translationPrompts\.englishToChinese/);
assert.doesNotMatch(main, /const strictComposerEnglishPrompt|const composerLayoutPrompt/);
assert.match(
  main,
  /messages:\s*\[\s*\{ role: 'system', content: systemPrompt \},\s*\{ role: 'user', content: sensitiveTokenProtection\.text \}\s*\]/,
  'translation rules and source text must use separate system/user messages'
);

console.log('composer-question-mark: 你确定吗？ -> Are you sure? contract passed');
