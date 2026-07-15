const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const projectRoot = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(projectRoot, 'electron', 'main.ts'), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start + startMarker.length, end);
}

const productionQueueSource = sourceBetween(
  main,
  '// SIGNAL_LIVE_TRANSLATION_QUEUE_START',
  '// SIGNAL_LIVE_TRANSLATION_QUEUE_END'
);

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, label, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await delay(2);
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function normalizeSourceText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function legacySourceHash(value) {
  let hash = 2166136261;
  for (const char of normalizeSourceText(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function createHarness(overrides = {}) {
  const events = [];
  const sentCommands = [];
  const activeSignalCacheConversations = new Map();
  const pendingSnapshots = new Map();
  let translateCalls = 0;
  let lookupCalls = 0;
  let saveCalls = 0;
  let eligible = true;
  const translateRequests = [];
  const saveRequests = [];

  const queueSource = productionQueueSource
    .replace(
      'const signalLiveTranslationRefreshCoalesceMs = 100;',
      'const signalLiveTranslationRefreshCoalesceMs = 5;'
    )
    .replace(
      'const signalLiveTranslationRetryDelaysMs = [5_000, 30_000] as const;',
      'const signalLiveTranslationRetryDelaysMs = [5, 15] as const;'
    )
    .replace(
      'const signalTranslationRefreshCooldownMs = 1_500;',
      'const signalTranslationRefreshCooldownMs = 20;'
    )
    .replace(
      '.catch(() => {',
      '.catch(error => { globalThis.__signalLiveQueueLastError = error;'
    );
  const exposed = `
    globalThis.__signalLiveQueue = {
      enqueueSignalLiveTranslation,
      enqueueSignalTranslationRefresh,
      cancelSignalLiveTranslationsForApp,
      signalLiveTranslationPendingKeys,
      signalLiveTranslationQueue,
      signalLiveTranslationRetryTimers,
      signalLiveTranslationRunningProfiles,
      signalTranslationRefreshStates,
      trimSignalTranslationRefreshStates,
      get runningCount() { return signalLiveTranslationRunningCount; },
      get lastError() { return globalThis.__signalLiveQueueLastError; }
    };
  `;
  const transpiled = ts.transpileModule(
    `const signalCachePendingRequestLimit = 128;\nconst signalCacheProtocolMaxTextBytes = 64 * 1024;\n${queueSource}\n${exposed}`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None,
        strict: true
      },
      reportDiagnostics: true
    }
  );
  assert.deepEqual(
    (transpiled.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error),
    [],
    'Signal live translation queue must transpile in isolation'
  );

  const sandbox = {
    AbortController,
    Buffer,
    clearTimeout,
    createHash,
    randomUUID,
    setTimeout,
    signalSourceOnlyAcceptanceActive: false,
    activeSignalCacheConversations,
    appendSignalSourceOnlyAcceptanceStage() {},
    normalizeSignalCacheSourceText(value) {
      return normalizeSourceText(value);
    },
    isValidSignalTranslationProjection(message) {
      const sourceText = normalizeSourceText(message.sourceText);
      return Boolean(
        sourceText === message.sourceText &&
        sourceText.length > 0 &&
        sourceText.length <= 4_000 &&
        /[A-Za-z]/.test(sourceText) &&
        !/[\u3400-\u9fff]/u.test(sourceText) &&
        legacySourceHash(sourceText) === message.sourceHash
      );
    },
    isUsefulSignalCacheTranslation(sourceText, translatedText) {
      const source = String(sourceText || '').trim().toLowerCase();
      const translated = String(translatedText || '').trim();
      return Boolean(translated && translated.toLowerCase() !== source && /[\u4e00-\u9fff]/.test(translated));
    },
    getSignalCacheControlContext(appId, expectedClient) {
      const active = activeSignalCacheConversations.get(appId);
      if (!eligible || !active || active.client !== expectedClient) return null;
      return { profileId: appId.slice('signal:'.length), client: expectedClient };
    },
    async isMarkedNonEnglishContact(request) {
      return overrides.isMarkedNonEnglishContact
        ? overrides.isMarkedNonEnglishContact(request)
        : false;
    },
    async lookupTranslationCache(request) {
      lookupCalls += 1;
      return overrides.lookupTranslationCache
        ? overrides.lookupTranslationCache(request)
        : [];
    },
    async translateWithDeepSeek(request, abortSignal, logPolicy) {
      translateCalls += 1;
      translateRequests.push({ request, abortSignal, logPolicy });
      events.push(`translate:${request.messageKey}`);
      return overrides.translateWithDeepSeek
        ? overrides.translateWithDeepSeek(request, translateCalls, abortSignal)
        : '你好';
    },
    async saveTranslationCacheEntry(request, shouldContinue, options) {
      if (shouldContinue && !shouldContinue()) return false;
      saveCalls += 1;
      saveRequests.push({ request, options });
      events.push(`save-start:${request.sourceHash}`);
      if (overrides.saveTranslationCacheEntry) {
        await overrides.saveTranslationCacheEntry(
          request,
          saveCalls,
          shouldContinue,
          options
        );
      }
      events.push(`save-end:${request.sourceHash}`);
      return shouldContinue ? shouldContinue() : true;
    },
    validateSignalMessageSnapshotRequest(value) {
      return value;
    },
    setPendingSignalCacheRequest(appId, request) {
      pendingSnapshots.set(request.requestId, { appId, request });
      return true;
    },
    deletePendingSignalCacheRequest(_appId, requestId) {
      pendingSnapshots.delete(requestId);
    },
    sendSignalControlMessage(appId, command) {
      events.push(`snapshot:${command.requestId}`);
      sentCommands.push({ appId, command });
      return true;
    }
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(transpiled.outputText, sandbox, {
    filename: 'signal-live-translation-queue.js'
  });

  const client = { socket: { destroyed: false } };
  const profileId = '11111111-1111-4111-8111-111111111111';
  const appId = `signal:${profileId}`;
  const conversationId = '22222222-2222-4222-8222-222222222222';
  activeSignalCacheConversations.set(appId, { conversationId, client });

  return {
    queue: sandbox.__signalLiveQueue,
    client,
    profileId,
    appId,
    conversationId,
    events,
    sentCommands,
    pendingSnapshots,
    activeSignalCacheConversations,
    get translateCalls() {
      return translateCalls;
    },
    get lookupCalls() {
      return lookupCalls;
    },
    get saveCalls() {
      return saveCalls;
    },
    translateRequests,
    saveRequests,
    setEligible(value) {
      eligible = value;
    }
  };
}

function message(harness, index = 1, sourceText = `Hello ${index}`) {
  return {
    conversationId: harness.conversationId,
    messageId: `${String(index).padStart(8, '0')}-3333-4333-8333-333333333333`,
    sourceHash: legacySourceHash(sourceText),
    sourceText,
    direction: 'incoming',
    timestamp: index
  };
}

async function testCacheHitSkipsDeepSeek() {
  const harness = createHarness({
    lookupTranslationCache(request) {
      return [{
        sourceHash: request.sourceHashes[0],
        sourceText: 'Hello 1',
        translatedText: '缓存译文'
      }];
    }
  });
  assert.equal(
    harness.queue.enqueueSignalLiveTranslation(
      harness.appId,
      harness.profileId,
      harness.client,
      message(harness)
    ),
    true
  );
  await waitFor(() => harness.queue.signalLiveTranslationPendingKeys.size === 0, 'cache-hit completion');
  await waitFor(() => harness.sentCommands.length === 1, 'cache-hit snapshot refresh');
  assert.equal(harness.translateCalls, 0);
  assert.equal(harness.saveCalls, 0);
}

async function testSavePrecedesSnapshot() {
  const saveGate = deferred();
  const harness = createHarness({
    async saveTranslationCacheEntry() {
      await saveGate.promise;
    }
  });
  harness.queue.enqueueSignalLiveTranslation(
    harness.appId,
    harness.profileId,
    harness.client,
    message(harness)
  );
  try {
    await waitFor(() => harness.events.some(event => event.startsWith('save-start:')), 'cache save start');
  } catch (error) {
    throw new Error(`${error.message}; events=${JSON.stringify(harness.events)} pending=${harness.queue.signalLiveTranslationPendingKeys.size} lastError=${harness.queue.lastError?.stack || harness.queue.lastError}`);
  }
  assert.equal(harness.sentCommands.length, 0, 'snapshot must wait for encrypted cache write');
  saveGate.resolve();
  await waitFor(() => harness.sentCommands.length === 1, 'post-save snapshot');
  const saveEnd = harness.events.findIndex(event => event.startsWith('save-end:'));
  const snapshot = harness.events.findIndex(event => event.startsWith('snapshot:'));
  assert.ok(saveEnd >= 0 && snapshot > saveEnd);
}

async function testDedupeAndProfileConcurrency() {
  const first = deferred();
  const second = deferred();
  const harness = createHarness({
    translateWithDeepSeek(_request, call) {
      return call === 1 ? first.promise : second.promise;
    }
  });
  const firstMessage = message(harness, 1);
  assert.equal(harness.queue.enqueueSignalLiveTranslation(harness.appId, harness.profileId, harness.client, firstMessage), true);
  assert.equal(harness.queue.enqueueSignalLiveTranslation(harness.appId, harness.profileId, harness.client, firstMessage), false);
  assert.equal(harness.queue.enqueueSignalLiveTranslation(harness.appId, harness.profileId, harness.client, message(harness, 2)), true);
  await waitFor(() => harness.translateCalls === 1, 'first profile translation');
  await delay(10);
  assert.equal(harness.translateCalls, 1, 'a profile must run only one normal translation at once');
  first.resolve('第一条');
  await waitFor(() => harness.translateCalls === 2, 'second profile translation');
  second.resolve('第二条');
  await waitFor(() => harness.queue.signalLiveTranslationPendingKeys.size === 0, 'deduped queue completion');
}

async function testGlobalConcurrency() {
  const gates = [];
  const harness = createHarness({
    translateWithDeepSeek() {
      const gate = deferred();
      gates.push(gate);
      return gate.promise;
    }
  });
  for (let index = 1; index <= 25; index += 1) {
    const profileId = `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`;
    const appId = `signal:${profileId}`;
    const client = { socket: { destroyed: false } };
    harness.activeSignalCacheConversations.set(appId, {
      conversationId: harness.conversationId,
      client
    });
    assert.equal(
      harness.queue.enqueueSignalLiveTranslation(
        appId,
        profileId,
        client,
        message(harness, index)
      ),
      true
    );
  }
  await waitFor(() => harness.translateCalls === 24, 'global concurrency saturation');
  await delay(10);
  assert.equal(harness.translateCalls, 24, 'the twenty-fifth request must remain queued');
  gates[0].resolve('第一批');
  await waitFor(() => harness.translateCalls === 25, 'global concurrency release');
  for (const gate of gates) gate.resolve('批量译文');
  await waitFor(() => harness.queue.signalLiveTranslationPendingKeys.size === 0, 'global queue completion');
}

async function testTwoRetriesThenStop() {
  const harness = createHarness({
    translateWithDeepSeek() {
      throw new Error('synthetic network failure');
    }
  });
  harness.queue.enqueueSignalLiveTranslation(
    harness.appId,
    harness.profileId,
    harness.client,
    message(harness)
  );
  await waitFor(() => harness.queue.signalLiveTranslationPendingKeys.size === 0, 'retry exhaustion');
  assert.equal(harness.translateCalls, 3, 'initial attempt plus two retries are allowed');
  assert.equal(harness.saveCalls, 0);
  assert.equal(harness.sentCommands.length, 0);
}

async function testInvalidTranslationIsNeverPersisted() {
  const harness = createHarness({
    translateWithDeepSeek() {
      return 'Hello 1';
    }
  });
  harness.queue.enqueueSignalLiveTranslation(
    harness.appId,
    harness.profileId,
    harness.client,
    message(harness)
  );
  await waitFor(() => harness.queue.signalLiveTranslationPendingKeys.size === 0, 'invalid-result exhaustion');
  assert.equal(harness.translateCalls, 3);
  assert.equal(harness.saveCalls, 0, 'same-text/non-Chinese results must never enter encrypted cache');
  assert.equal(harness.sentCommands.length, 0, 'invalid results must never refresh the Signal slot');
}

async function testProjectionAndCapacityGuards() {
  const harness = createHarness();
  const wrongHash = { ...message(harness), sourceHash: '1' };
  const unnormalized = message(harness, 2, 'Hello   there');
  const mixedCjk = message(harness, 3, 'Hello 世界');
  const oversized = message(harness, 4, `A${'b'.repeat(4_000)}`);
  for (const candidate of [wrongHash, unnormalized, mixedCjk, oversized]) {
    assert.equal(
      harness.queue.enqueueSignalLiveTranslation(
        harness.appId,
        harness.profileId,
        harness.client,
        candidate
      ),
      false
    );
  }

  for (let index = 1; index <= 128; index += 1) {
    assert.equal(
      harness.queue.enqueueSignalLiveTranslation(
        harness.appId,
        harness.profileId,
        harness.client,
        message(harness, index, `Capacity ${index}`)
      ),
      true
    );
  }
  assert.equal(
    harness.queue.enqueueSignalLiveTranslation(
      harness.appId,
      harness.profileId,
      harness.client,
      message(harness, 129, 'Capacity rejected')
    ),
    false,
    'the 129th pending task must be rejected before any API call'
  );
  harness.queue.cancelSignalLiveTranslationsForApp(harness.appId);
  assert.equal(harness.queue.signalLiveTranslationPendingKeys.size, 0);
  assert.equal(harness.translateCalls, 0);
}

async function testCancellationDuringCacheLookup() {
  const lookupGate = deferred();
  let lookupStarted = false;
  const harness = createHarness({
    lookupTranslationCache() {
      lookupStarted = true;
      return lookupGate.promise;
    }
  });
  harness.queue.enqueueSignalLiveTranslation(
    harness.appId,
    harness.profileId,
    harness.client,
    message(harness)
  );
  await waitFor(() => lookupStarted, 'cache lookup start');
  harness.setEligible(false);
  harness.activeSignalCacheConversations.delete(harness.appId);
  harness.queue.cancelSignalLiveTranslationsForApp(harness.appId);
  lookupGate.resolve([]);
  await waitFor(() => harness.queue.runningCount === 0, 'cache lookup cancellation');
  assert.equal(harness.translateCalls, 0, 'a closed gate must prevent a post-lookup API request');
  assert.equal(harness.saveCalls, 0);
  assert.equal(harness.sentCommands.length, 0);
}

async function testLifecycleCancellation() {
  const harness = createHarness({
    translateWithDeepSeek(_request, _call, abortSignal) {
      return new Promise((_resolve, reject) => {
        abortSignal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      });
    }
  });
  harness.queue.enqueueSignalLiveTranslation(harness.appId, harness.profileId, harness.client, message(harness, 1));
  harness.queue.enqueueSignalLiveTranslation(harness.appId, harness.profileId, harness.client, message(harness, 2));
  await waitFor(() => harness.translateCalls === 1, 'in-flight translation before cancellation');
  harness.setEligible(false);
  harness.activeSignalCacheConversations.delete(harness.appId);
  harness.queue.cancelSignalLiveTranslationsForApp(harness.appId);
  await waitFor(() => harness.queue.runningCount === 0, 'in-flight completion after cancellation');
  await delay(15);
  assert.equal(harness.translateCalls, 1, 'queued work must be discarded when the gate closes');
  assert.equal(harness.saveCalls, 0, 'cancelled in-flight work must not persist message content');
  assert.equal(harness.sentCommands.length, 0, 'stale work must never refresh a closed conversation');
}

async function testManualRefreshBypassesCacheAndDedupesCooldown() {
  const harness = createHarness({
    isMarkedNonEnglishContact() {
      return true;
    },
    lookupTranslationCache() {
      return [{
        sourceHash: legacySourceHash('Hello 1'),
        sourceText: 'Hello 1',
        translatedText: '\u7f13\u5b58\u8bd1\u6587'
      }];
    },
    translateWithDeepSeek() {
      return '\u5f3a\u5236\u8bd1\u6587';
    }
  });
  const candidate = message(harness);
  assert.equal(
    harness.queue.enqueueSignalTranslationRefresh(
      harness.appId,
      harness.profileId,
      harness.client,
      candidate
    ),
    true
  );
  assert.equal(
    harness.queue.enqueueSignalTranslationRefresh(
      harness.appId,
      harness.profileId,
      harness.client,
      candidate
    ),
    false,
    'an identical per-message refresh inside the cooldown must be deduped'
  );
  await waitFor(() => harness.queue.signalLiveTranslationPendingKeys.size === 0, 'manual refresh completion');
  await waitFor(() => harness.sentCommands.length === 1, 'manual refresh snapshot');
  assert.equal(harness.lookupCalls, 0, 'manual refresh must bypass encrypted cache lookup');
  assert.equal(harness.translateCalls, 1, 'manual refresh must force one DeepSeek request');
  assert.equal(harness.saveCalls, 1);
  assert.equal(harness.saveRequests[0].options.bypassNonEnglishContactGuard, true);
  assert.equal(harness.translateRequests[0].logPolicy, 'content-free');
  assert.equal(
    Array.from(harness.pendingSnapshots.values())[0].request.acceptanceTrigger.forceCacheResult,
    true,
    'manual refresh snapshot must carry a request-scoped forced cache-result projection'
  );

  await delay(25);
  assert.equal(
    harness.queue.enqueueSignalTranslationRefresh(
      harness.appId,
      harness.profileId,
      harness.client,
      candidate
    ),
    true,
    'the same message may be explicitly refreshed again after the bounded cooldown'
  );
  await waitFor(() => harness.translateCalls === 2, 'post-cooldown forced translation');
  await waitFor(() => harness.queue.signalLiveTranslationPendingKeys.size === 0, 'post-cooldown completion');
  await waitFor(() => harness.sentCommands.length === 2, 'post-cooldown snapshot');
  assert.equal(harness.lookupCalls, 0);
}

async function testNewManualRefreshSupersedesStaleResult() {
  const first = deferred();
  const second = deferred();
  const harness = createHarness({
    translateWithDeepSeek(_request, call) {
      return call === 1 ? first.promise : second.promise;
    }
  });
  const candidate = message(harness);
  assert.equal(
    harness.queue.enqueueSignalTranslationRefresh(
      harness.appId,
      harness.profileId,
      harness.client,
      candidate
    ),
    true
  );
  await waitFor(() => harness.translateCalls === 1, 'first manual refresh');
  await delay(25);
  assert.equal(
    harness.queue.enqueueSignalTranslationRefresh(
      harness.appId,
      harness.profileId,
      harness.client,
      candidate
    ),
    true
  );
  assert.equal(
    harness.translateRequests[0].abortSignal.aborted,
    true,
    'a newer accepted refresh must abort the older in-flight request'
  );
  first.resolve('\u65e7\u8bd1\u6587');
  await waitFor(() => harness.translateCalls === 2, 'replacement manual refresh');
  second.resolve('\u65b0\u8bd1\u6587');
  await waitFor(() => harness.queue.signalLiveTranslationPendingKeys.size === 0, 'replacement completion');
  await waitFor(() => harness.sentCommands.length === 1, 'replacement snapshot');
  assert.equal(harness.saveCalls, 1, 'the stale completed result must never enter encrypted cache');
  assert.equal(harness.saveRequests[0].request.translatedText, '\u65b0\u8bd1\u6587');
  assert.equal(harness.translateRequests[1].logPolicy, 'content-free');
}

function testManualRefreshStateIsBounded() {
  const harness = createHarness();
  for (let index = 0; index < 513; index += 1) {
    harness.queue.signalTranslationRefreshStates.set(`state-${index}`, {
      appId: harness.appId,
      revision: 1,
      projectionKey: `projection-${index}`,
      acceptedAt: index,
      taskKey: `completed-${index}`
    });
  }
  harness.queue.trimSignalTranslationRefreshStates();
  assert.equal(
    harness.queue.signalTranslationRefreshStates.size,
    512,
    'completed per-message cooldown state must remain bounded'
  );
}

async function mainTest() {
  await testCacheHitSkipsDeepSeek();
  await testSavePrecedesSnapshot();
  await testDedupeAndProfileConcurrency();
  await testGlobalConcurrency();
  await testTwoRetriesThenStop();
  await testInvalidTranslationIsNeverPersisted();
  await testProjectionAndCapacityGuards();
  await testCancellationDuringCacheLookup();
  await testLifecycleCancellation();
  await testManualRefreshBypassesCacheAndDedupesCooldown();
  await testNewManualRefreshSupersedesStaleResult();
  testManualRefreshStateIsBounded();
  console.log('signal-live-translation-queue: cache, force-refresh, ordering, dedupe, retry, and lifecycle contracts passed');
}

mainTest().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
