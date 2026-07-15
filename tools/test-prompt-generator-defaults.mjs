import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'config', 'translation-prompts.default.json'), 'utf8').replace(/^\uFEFF/, ''));
const main = fs.readFileSync(path.join(root, 'electron', 'prompt-generator.ts'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'prompt-generator-preload.cjs'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'prompt-generator', 'renderer.js'), 'utf8');
const generatorBuilder = fs.readFileSync(path.join(root, 'electron-builder.prompt-generator.cjs'), 'utf8');
const clientBuilder = fs.readFileSync(path.join(root, 'electron-builder.client-suite.cjs'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.match(defaults.chineseToEnglish, /38 岁女性口吻/);
assert.match(defaults.chineseToEnglish, /最末尾不使用句号/);
assert.match(defaults.chineseToEnglish, /不要机械固定翻译成 Yes/);
assert.match(defaults.englishToChinese, /所有可翻译内容/);
assert.match(defaults.englishToChinese, /自然、简洁的简体中文/);
assert.match(main, /prompt-generator:defaults/);
assert.match(preload, /getDefaults/);
assert.match(renderer, /loadDefaultPrompts/);
assert.match(renderer, /zhEn\.value = defaultPrompts\.chineseToEnglish/);
assert.match(generatorBuilder, /config\/translation-prompts\.default\.json/);
assert.doesNotMatch(clientBuilder, /translation-prompts\.source\.json/);
assert.equal(JSON.stringify(packageJson.build.extraResources).includes('translation-prompts.source.json'), false);

console.log('prompt-generator-defaults: approved defaults preload in internal generator and stay out of customer packages');
