const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const projectRoot = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(projectRoot, 'electron/main.ts'), 'utf8');
const v818CacheBridgePatch = fs.readFileSync(
  path.join(
    projectRoot,
    'signal-source',
    'patches',
    'v8.18.0',
    '0004-maoyi-source-translation-cache-bridge.patch'
  ),
  'utf8'
);

function sourceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label}: start marker is missing`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${label}: end marker is missing`);
  return source.slice(start + startMarker.length, end);
}

const pureProtocolSource = sourceBetween(
  main,
  '// SIGNAL_CACHE_PROTOCOL_PURE_START',
  '// SIGNAL_CACHE_PROTOCOL_PURE_END',
  'pure Signal cache protocol'
);
const exposedFunctions = [
  'stripSignalControlTransportMetadata',
  'validateSignalConversationChangedMessage',
  'validateSignalMessageSnapshotRequest',
  'validateSignalVisibleMessageBatch',
  'validateSignalMessageAdded',
  'validateSignalTranslationRefreshRequest',
  'validateSignalCacheResultBatch',
  'validateSignalCacheResultAppliedMessage',
  'normalizeSignalCacheSourceText',
  'legacySignalSourceHash',
  'isValidSignalTranslationProjection',
  'isUsefulSignalCacheTranslation'
];
const transpiled = ts.transpileModule(
  `${pureProtocolSource}\n` +
    `globalThis.__signalCacheProtocol = { ${exposedFunctions.join(', ')} };`,
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
  (transpiled.diagnostics || []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error),
  [],
  'pure Signal cache protocol must transpile without diagnostics'
);
const sandbox = { Buffer };
sandbox.globalThis = sandbox;
vm.runInNewContext(transpiled.outputText, sandbox, { filename: 'signal-cache-protocol.pure.js' });
const protocol = sandbox.__signalCacheProtocol;
assert.ok(protocol, 'pure Signal cache protocol was not exposed to the test sandbox');

const requestId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const messageId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
const appId = `signal:${requestId}`;

const transportPayload = {
  appId,
  at: 1_720_000_000_000,
  type: 'conversation.changed',
  conversationId
};
assert.equal(
  JSON.stringify(protocol.stripSignalControlTransportMetadata(transportPayload, appId)),
  JSON.stringify({ type: 'conversation.changed', conversationId }),
  'authenticated transport metadata must be removed before strict business validation'
);
assert.deepEqual(
  transportPayload,
  { appId, at: 1_720_000_000_000, type: 'conversation.changed', conversationId },
  'transport metadata stripping must not mutate the MAC-authenticated payload'
);
for (const [payload, expectedAppId, label] of [
  [{ ...transportPayload, appId: `signal:${conversationId}` }, appId, 'mismatched payload appId'],
  [{ ...transportPayload, at: -1 }, appId, 'negative transport timestamp'],
  [{ ...transportPayload, at: 1.5 }, appId, 'fractional transport timestamp'],
  [{ ...transportPayload, at: '1720000000000' }, appId, 'non-numeric transport timestamp'],
  [{ appId, at: 1_720_000_000_000, conversationId }, appId, 'missing business event type'],
  [[], appId, 'array payload']
]) {
  assert.equal(
    protocol.stripSignalControlTransportMetadata(payload, expectedAppId),
    null,
    `transport metadata must reject ${label}`
  );
}

function visibleMessage(overrides = {}) {
  return {
    conversationId,
    messageId,
    sourceHash: '1dzagm4',
    sourceText: 'Hello?',
    direction: 'incoming',
    timestamp: Number.MAX_SAFE_INTEGER,
    ...overrides
  };
}

function visibleBatch(overrides = {}) {
  return {
    type: 'message.visibleBatch',
    requestId,
    conversationId,
    messages: [visibleMessage()],
    ...overrides
  };
}

function translationRefreshRequest(overrides = {}) {
  return {
    type: 'translation.refresh.request',
    requestId,
    ...visibleMessage(),
    ...overrides
  };
}

function cacheResult(overrides = {}) {
  return {
    conversationId,
    messageId,
    sourceHash: '1dzagm4',
    sourceText: 'Hello?',
    translatedText: '你好？',
    ...overrides
  };
}

function cacheResultBatch(overrides = {}) {
  return {
    type: 'translation.cacheResultBatch',
    requestId,
    conversationId,
    results: [cacheResult()],
    ...overrides
  };
}

function rejects(action, label) {
  assert.throws(
    action,
    error => Boolean(error && typeof error.message === 'string'),
    label
  );
}

assert.equal(
  protocol.validateSignalConversationChangedMessage({ type: 'conversation.changed', conversationId }).conversationId,
  conversationId
);
rejects(
  () => protocol.validateSignalConversationChangedMessage({ type: 'conversation.changed', conversationId, profileId: requestId }),
  'conversation.changed must reject undeclared fields'
);
assert.equal(
  protocol.validateSignalMessageSnapshotRequest({ type: 'message.snapshot.request', requestId }).requestId,
  requestId
);
rejects(
  () => protocol.validateSignalMessageSnapshotRequest({ type: 'message.snapshot.request', requestId: 'not-a-uuid' }),
  'snapshot request must reject non-UUID request IDs'
);

assert.equal(protocol.validateSignalVisibleMessageBatch(visibleBatch()).messages.length, 1);
assert.equal(protocol.validateSignalVisibleMessageBatch(visibleBatch({ messages: [] })).messages.length, 0);
assert.deepEqual(
  JSON.parse(JSON.stringify(protocol.validateSignalMessageAdded({
    type: 'message.added',
    ...visibleMessage()
  }))),
  {
    type: 'message.added',
    ...visibleMessage()
  }
);
rejects(
  () => protocol.validateSignalMessageAdded({
    type: 'message.added',
    ...visibleMessage({ conversationId: 'not-a-uuid' })
  }),
  'message.added must reject an invalid conversation identity'
);
rejects(
  () => protocol.validateSignalMessageAdded({
    type: 'message.added',
    ...visibleMessage(),
    profileId: requestId
  }),
  'message.added must reject undeclared fields and renderer-supplied profile IDs'
);
for (const invalidMessage of [
  visibleMessage({ sourceHash: '1' }),
  visibleMessage({ sourceText: ' Hello?' }),
  visibleMessage({ sourceText: '你好 Hello?', sourceHash: '1' }),
  visibleMessage({ sourceText: '12345', sourceHash: '1' }),
  visibleMessage({ sourceText: `A${'b'.repeat(4_000)}`, sourceHash: '1' })
]) {
  rejects(
    () => protocol.validateSignalMessageAdded({ type: 'message.added', ...invalidMessage }),
    'message.added must reject noncanonical, non-English, oversized, or hash-mismatched projections'
  );
}
assert.deepEqual(
  JSON.parse(JSON.stringify(
    protocol.validateSignalTranslationRefreshRequest(translationRefreshRequest())
  )),
  translationRefreshRequest(),
  'a refresh request must be returned as a canonical projection'
);
for (const [extraField, extraValue] of [
  ['appId', appId],
  ['profileId', requestId],
  ['translatedText', 'cached'],
  ['contactId', conversationId],
  ['force', true]
]) {
  rejects(
    () => protocol.validateSignalTranslationRefreshRequest(
      translationRefreshRequest({ [extraField]: extraValue })
    ),
    `translation.refresh.request must reject undeclared field ${extraField}`
  );
}
for (const invalidRequest of [
  translationRefreshRequest({ requestId: 'not-a-uuid' }),
  translationRefreshRequest({ sourceHash: '1' }),
  translationRefreshRequest({ sourceText: ' Hello?' }),
  translationRefreshRequest({ direction: 'unknown' }),
  translationRefreshRequest({ timestamp: -1 })
]) {
  rejects(
    () => protocol.validateSignalTranslationRefreshRequest(invalidRequest),
    'translation.refresh.request must reject invalid identity or non-canonical projections'
  );
}
assert.equal(
  protocol.validateSignalVisibleMessageBatch(visibleBatch({
    requestId: 'AAAAAAAA-AAAA-8AAA-AAAA-AAAAAAAAAAAA'
  })).requestId,
  'AAAAAAAA-AAAA-8AAA-AAAA-AAAAAAAAAAAA',
  'UUID versions 1 through 8 and RFC variants must be accepted case-insensitively'
);
rejects(
  () => protocol.validateSignalVisibleMessageBatch(visibleBatch({ requestId: '11111111-1111-9111-8111-111111111111' })),
  'UUID versions outside 1 through 8 must be rejected'
);
rejects(
  () => protocol.validateSignalVisibleMessageBatch(visibleBatch({ requestId: '11111111-1111-4111-7111-111111111111' })),
  'non-RFC UUID variants must be rejected'
);

const oneHundredMessages = Array.from({ length: 100 }, (_, index) => visibleMessage({
  messageId: `${(index + 1).toString(16).padStart(8, '0')}-3333-4333-8333-333333333333`,
  sourceText: 'a'
}));
assert.equal(
  protocol.validateSignalVisibleMessageBatch(visibleBatch({ messages: oneHundredMessages })).messages.length,
  100
);
rejects(
  () => protocol.validateSignalVisibleMessageBatch(visibleBatch({
    messages: [...oneHundredMessages, visibleMessage({ messageId: 'ffffffff-3333-4333-8333-333333333333' })]
  })),
  'visible batches over 100 messages must be rejected'
);
rejects(
  () => protocol.validateSignalVisibleMessageBatch(visibleBatch({
    messages: [visibleMessage(), visibleMessage({ messageId: messageId.toUpperCase() })]
  })),
  'duplicate semantic message UUIDs must be rejected'
);
rejects(
  () => protocol.validateSignalVisibleMessageBatch(visibleBatch({
    messages: [visibleMessage({ conversationId: requestId })]
  })),
  'message conversationId must equal the outer conversationId'
);

for (const sourceHash of ['A', '01', '12345678', '-1', '']) {
  rejects(
    () => protocol.validateSignalVisibleMessageBatch(visibleBatch({ messages: [visibleMessage({ sourceHash })] })),
    `non-canonical source hash must be rejected: ${sourceHash}`
  );
}
for (const sourceHash of ['0', '1', 'z', '1z141z3']) {
  assert.equal(
    protocol.validateSignalVisibleMessageBatch(visibleBatch({ messages: [visibleMessage({ sourceHash })] })).messages[0].sourceHash,
    sourceHash
  );
}
rejects(
  () => protocol.validateSignalVisibleMessageBatch(visibleBatch({ messages: [visibleMessage({ direction: 'unknown' })] })),
  'unknown direction must be rejected'
);
rejects(
  () => protocol.validateSignalVisibleMessageBatch(visibleBatch({ messages: [visibleMessage({ timestamp: -1 })] })),
  'negative timestamps must be rejected'
);
rejects(
  () => protocol.validateSignalVisibleMessageBatch(visibleBatch({ messages: [visibleMessage({ timestamp: 1.5 })] })),
  'fractional timestamps must be rejected'
);
rejects(
  () => protocol.validateSignalVisibleMessageBatch(visibleBatch({ messages: [visibleMessage({ timestamp: Number.MAX_SAFE_INTEGER + 1 })] })),
  'unsafe timestamps must be rejected'
);
rejects(
  () => protocol.validateSignalVisibleMessageBatch(visibleBatch({ messages: [visibleMessage({ sourceText: '' })] })),
  'empty source text must be rejected'
);
assert.equal(
  protocol.validateSignalVisibleMessageBatch(visibleBatch({
    messages: [visibleMessage({ sourceText: 'a'.repeat(64 * 1024) })]
  })).messages[0].sourceText.length,
  64 * 1024
);
rejects(
  () => protocol.validateSignalVisibleMessageBatch(visibleBatch({
    messages: [visibleMessage({ sourceText: '汉'.repeat(Math.floor((64 * 1024) / 3) + 1) })]
  })),
  'source text over 64 KiB in UTF-8 must be rejected'
);
rejects(
  () => protocol.validateSignalVisibleMessageBatch(visibleBatch({
    messages: oneHundredMessages.map(message => ({ ...message, sourceText: 'a'.repeat(8 * 1024) }))
  })),
  'business JSON over 768 KiB must be rejected even when individual texts are valid'
);

assert.equal(protocol.validateSignalCacheResultBatch(cacheResultBatch()).results.length, 1);
assert.equal(protocol.validateSignalCacheResultBatch(cacheResultBatch({ results: [] })).results.length, 0);
rejects(
  () => protocol.validateSignalCacheResultBatch(cacheResultBatch({
    results: [cacheResult({ unexpected: true })]
  })),
  'cache results must reject undeclared fields'
);
rejects(
  () => protocol.validateSignalCacheResultBatch(cacheResultBatch({
    results: [
      ...oneHundredMessages.map(message => cacheResult({
        messageId: message.messageId,
        sourceText: message.sourceText
      })),
      cacheResult({ messageId: 'ffffffff-3333-4333-8333-333333333333' })
    ]
  })),
  'cache result batches over 100 results must be rejected'
);
rejects(
  () => protocol.validateSignalCacheResultBatch(cacheResultBatch({
    results: [cacheResult({ translatedText: '' })]
  })),
  'empty translated text must be rejected'
);
rejects(
  () => protocol.validateSignalCacheResultBatch(cacheResultBatch({
    results: [cacheResult({ translatedText: '汉'.repeat(Math.floor((64 * 1024) / 3) + 1) })]
  })),
  'translated text over 64 KiB in UTF-8 must be rejected'
);
rejects(
  () => protocol.validateSignalCacheResultBatch(cacheResultBatch({
    results: [cacheResult(), cacheResult({ messageId: messageId.toUpperCase() })]
  })),
  'cache result batches must reject duplicate semantic message UUIDs'
);

for (const appliedCount of [0, 100]) {
  assert.equal(
    protocol.validateSignalCacheResultAppliedMessage({
      type: 'translation.cacheResultApplied',
      requestId,
      appliedCount
    }).appliedCount,
    appliedCount
  );
}
for (const appliedCount of [-1, 1.5, 101]) {
  rejects(
    () => protocol.validateSignalCacheResultAppliedMessage({
      type: 'translation.cacheResultApplied',
      requestId,
      appliedCount
    }),
    `invalid appliedCount must be rejected: ${appliedCount}`
  );
}
assert.equal(
  protocol.normalizeSignalCacheSourceText('  Hello\r\n\tworld?  '),
  'Hello world?'
);
assert.equal(
  protocol.isUsefulSignalCacheTranslation('Hello?', '你好？'),
  true,
  'a useful cached Chinese translation must remain eligible'
);
assert.equal(
  protocol.isUsefulSignalCacheTranslation('Hello?', 'hello?'),
  false,
  'a case-insensitive copy of the source must be rejected'
);
assert.equal(
  protocol.isUsefulSignalCacheTranslation('Hello?', 'Hi?'),
  false,
  'a Latin-source cache result without Chinese text must be rejected'
);
assert.equal(
  protocol.isUsefulSignalCacheTranslation('Hello?', 'Return only the translated message: 你好'),
  false,
  'translation prompt leakage must be rejected'
);
assert.equal(
  protocol.isUsefulSignalCacheTranslation(
    'Pretty',
    '\u4fdd\u6301\u8868\u60c5\u7b26\u53f7\u3001URL\u3001\u7535\u8bdd\u53f7\u7801\u3001\u4ea7\u54c1\u540d\u79f0\u548c\u6362\u884c\u7b26\u4e0d\u53d8\u3002\n\u6f02\u4eae'
  ),
  false,
  'Chinese keep-constraint prompt leakage must be rejected'
);
assert.equal(
  protocol.isUsefulSignalCacheTranslation('Pretty', '你是一名英译中聊天翻译助手。\n漂亮'),
  false,
  'the current Chinese system prompt must never enter Signal cache output'
);

const ledgerStart = main.indexOf('type PendingSignalCacheSnapshotRequest =');
assert.notEqual(ledgerStart, -1, 'Signal cache request ledger start is missing');
const ledgerEnd = main.indexOf('type SignalVisibilityAckWaiter =', ledgerStart);
assert.notEqual(ledgerEnd, -1, 'Signal cache request ledger end is missing');
const ledgerSource = main.slice(ledgerStart, ledgerEnd).replace(
  /\/\/ SIGNAL_SOURCE_ONLY_ACCEPTANCE_DIAGNOSTICS_START[\s\S]*?\/\/ SIGNAL_SOURCE_ONLY_ACCEPTANCE_DIAGNOSTICS_END/,
  ''
);
const ledgerTranspiled = ts.transpileModule(
  `${ledgerSource}\n` +
    `globalThis.__signalCacheLedger = {
      signalCachePendingRequestLimit,
      signalCacheInFlightRequestLimit,
      pendingSignalCacheSnapshotRequests,
      signalCacheInFlightRequestCounts,
      clearSignalCacheRequestState,
      getPendingSignalCacheRequest,
      setPendingSignalCacheRequest,
      tryAcquireSignalCacheLookupSlot,
      releaseSignalCacheLookupSlot
    };`,
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
  (ledgerTranspiled.diagnostics || []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error),
  [],
  'Signal cache request ledger must transpile without diagnostics'
);
const ledgerSandbox = {};
ledgerSandbox.globalThis = ledgerSandbox;
vm.runInNewContext(ledgerTranspiled.outputText, ledgerSandbox, {
  filename: 'signal-cache-request-ledger.js'
});
const ledger = ledgerSandbox.__signalCacheLedger;
assert.ok(ledger, 'Signal cache request ledger was not exposed to the test sandbox');
assert.equal(ledger.signalCachePendingRequestLimit, 128);
assert.equal(ledger.signalCacheInFlightRequestLimit, 8);

const ledgerClient = { socket: { destroyed: false } };
const ledgerRequest = (requestId, state) => ({
  requestId,
  conversationId,
  client: ledgerClient,
  state
});
for (let index = 0; index < ledger.signalCacheInFlightRequestLimit; index += 1) {
  assert.equal(ledger.tryAcquireSignalCacheLookupSlot('signal:in-flight'), true);
}
assert.equal(
  ledger.tryAcquireSignalCacheLookupSlot('signal:in-flight'),
  false,
  'a ninth simultaneous cache lookup for one app must be rejected'
);
ledger.clearSignalCacheRequestState('signal:in-flight');
assert.equal(
  ledger.signalCacheInFlightRequestCounts.get('signal:in-flight'),
  8,
  'conversation/request clearing must not forget asynchronous lookups that are still running'
);
for (let index = 0; index < ledger.signalCacheInFlightRequestLimit; index += 1) {
  ledger.releaseSignalCacheLookupSlot('signal:in-flight');
}
assert.equal(ledger.signalCacheInFlightRequestCounts.has('signal:in-flight'), false);

for (let index = 0; index < 8; index += 1) {
  assert.equal(
    ledger.setPendingSignalCacheRequest(
      'signal:ledger',
      ledgerRequest(`responding-${index}`, 'responding')
    ),
    true
  );
}
for (let index = 0; index < 120; index += 1) {
  assert.equal(
    ledger.setPendingSignalCacheRequest(
      'signal:ledger',
      ledgerRequest(`completed-${index}`, 'completed')
    ),
    true
  );
}
assert.equal(
  ledger.setPendingSignalCacheRequest(
    'signal:ledger',
    ledgerRequest('completed-new', 'completed')
  ),
  true
);
const boundedRequests = ledger.pendingSignalCacheSnapshotRequests.get('signal:ledger');
assert.equal(boundedRequests.size, 128, 'request replay markers must stay bounded');
for (let index = 0; index < 8; index += 1) {
  assert.equal(
    boundedRequests.has(`responding-${index}`),
    true,
    'an in-flight request marker must never be evicted'
  );
}
assert.equal(boundedRequests.has('completed-0'), false, 'the oldest completed marker should be evicted first');
assert.equal(
  ledger.setPendingSignalCacheRequest(
    'signal:ledger',
    ledgerRequest('completed-new', 'pending')
  ),
  false,
  'a duplicate requestId must not replace its replay marker'
);

for (let index = 0; index < 128; index += 1) {
  assert.equal(
    ledger.setPendingSignalCacheRequest(
      'signal:all-responding',
      ledgerRequest(`responding-only-${index}`, 'responding')
    ),
    true
  );
}
assert.equal(
  ledger.setPendingSignalCacheRequest(
    'signal:all-responding',
    ledgerRequest('must-not-evict', 'pending')
  ),
  false,
  'a full ledger containing only in-flight markers must reject instead of evicting one'
);

const signalCommandTypes = sourceBetween(
  v818CacheBridgePatch,
  ' export type MaoyiControlCommand =',
  '\n export type MaoyiControlEvent =',
  'v8.18 Signal command direction'
);
assert.match(
  signalCommandTypes,
  /type: 'translation\.cacheResultBatch'/,
  'translation.cacheResultBatch must be a valid main-to-Signal command'
);
assert.doesNotMatch(
  signalCommandTypes,
  /type: 'error'/,
  'the Signal-to-main error event must never be mistaken for a main-to-Signal command'
);

const emptyResultSender = sourceBetween(
  main,
  'function sendEmptySignalCacheResultBatch(',
  '\nasync function respondToSignalVisibleMessageBatch(',
  'empty Signal cache result sender'
);
assert.match(emptyResultSender, /type: 'translation\.cacheResultBatch'/);
assert.match(emptyResultSender, /results: \[\]/);
assert.match(emptyResultSender, /validateSignalCacheResultBatch/);
assert.match(emptyResultSender, /sendSignalControlMessage\(appId, response\)/);
assert.doesNotMatch(emptyResultSender, /type: 'error'|message:/);

const responder = sourceBetween(
  main,
  'async function respondToSignalVisibleMessageBatch(',
  '\nfunction handleSignalControlMessage(',
  'Signal cache responder'
);
assert.match(responder, /platform: 'signal'/, 'cache lookup must be Signal-scoped');
assert.match(responder, /contactId: batch\.conversationId/, 'cache lookup must use the official conversationId');
assert.match(responder, /contactIdType: 'platform'/, 'cache lookup must use a stable platform contact ID');
assert.match(responder, /await lookupTranslationCache\(cacheRequest\)/, 'existing scoped lookup with profile-wide fallback must be used');
assert.match(
  responder,
  /normalizeSignalCacheSourceText\(message\.sourceText\) !== normalizeSignalCacheSourceText\(cached\.sourceText\)/,
  'hash-only cache matches must be rejected unless normalized source text is identical'
);
assert.match(
  responder,
  /isUsefulSignalCacheTranslation\(message\.sourceText, cached\.translatedText\)/,
  'legacy same-text, non-Chinese, and prompt-leak cache entries must remain filtered'
);
assert.match(
  responder,
  /pending\.acceptanceTrigger\?\.forceCacheResult === true[\s\S]*?\? false[\s\S]*?: await isMarkedNonEnglishContact\(cacheRequest\)/,
  'a request-scoped manual refresh must read back its encrypted result even for an excluded contact'
);
for (const marker of [
  'observeSignalTranslationRefresh(',
  'isSignalTranslationRefreshTriggerCurrent(profileId, pending)',
  'isSignalTranslationRefreshObservationSettled('
]) {
  assert.ok(
    responder.includes(marker),
    `cache response must suppress stale concurrent refresh results: ${marker}`
  );
}
assert.match(responder, /results: \[\]/, 'zero-hit requests must construct an empty cache result batch');
assert.match(responder, /sendSignalControlMessage\(appId, response\)/, 'zero-hit requests must still send the cache result batch');
assert.match(responder, /getSignalCacheControlContext\(appId, pending\.client\)/, 'visibility and authenticated-client state must be rechecked after async lookup');
assert.match(
  responder,
  /getPendingSignalCacheRequest\(appId, batch\.requestId\) !== pending/,
  'a superseded request or conversation must not receive a stale async response'
);
assert.match(
  responder,
  /const visibleCacheMisses: SignalVisibleMessage\[\] = \[\]/,
  'visible cache misses must be collected without exposing message contents to logs'
);
assert.match(
  responder,
  /if \(!acceptanceTrigger && !markedNonEnglish\) \{[\s\S]*?visibleCacheMisses\.push\(message\)/,
  'only ordinary visible cache misses for an eligible contact may enter automatic translation'
);
assert.match(
  responder,
  /if \(sent && !acceptanceTrigger\) \{[\s\S]*?enqueueSignalLiveTranslation\([\s\S]*?pending\.client[\s\S]*?message/,
  'automatic translation may start only after the authenticated empty cache response is sent'
);
assert.doesNotMatch(
  responder,
  /translateWithDeepSeek|deepseek|appendTranslateRequestLog|console\./i,
  'the visible responder must delegate bounded misses to the content-free queue instead of translating or logging inline'
);
assert.match(
  responder,
  /sendEmptySignalCacheResultBatch\(appId, batch\.requestId, batch\.conversationId\)/,
  'async failures must degrade to a protocol-valid empty cache result'
);
assert.doesNotMatch(
  responder,
  /type: 'error'|Signal translation cache lookup failed|error\.message|String\(error\)|sourceText.*message:/,
  'async failures must not send a direction-invalid error command or echo body/exception details'
);
assert.match(responder, /pending\.state = 'completed'/, 'an asynchronous lookup must leave a completed replay marker');
assert.match(responder, /releaseSignalCacheLookupSlot\(appId\)/, 'an asynchronous lookup must always release its in-flight slot');

const liveTranslationQueue = sourceBetween(
  main,
  '// SIGNAL_LIVE_TRANSLATION_QUEUE_START',
  '// SIGNAL_LIVE_TRANSLATION_QUEUE_END',
  'Signal live translation queue'
);
for (const marker of [
  'signalLiveTranslationGlobalConcurrency = 24',
  'signalLiveTranslationProfileConcurrency = 1',
  'signalLiveTranslationPendingLimit = signalCachePendingRequestLimit',
  'signalLiveTranslationSourceTextLimit = 4_000',
  'signalLiveTranslationRefreshCoalesceMs = 100',
  'signalLiveTranslationRetryDelaysMs = [5_000, 30_000]',
  'signalTranslationRefreshCooldownMs = 1_500',
  'signalTranslationRefreshStateLimit = 512',
  "createHash('sha256')",
  'normalizeSignalCacheSourceText(sourceText)',
  'isValidSignalTranslationProjection(message)',
  'isSignalLiveTranslationEligible(task)',
  'await lookupTranslationCache(cacheRequest)',
  'translateWithDeepSeek(',
  "'content-free'",
  "reason: 'visible-message'",
  "platform: 'signal'",
  "contactIdType: 'platform'",
  'isUsefulSignalCacheTranslation(task.sourceText, translatedText)',
  'await saveTranslationCacheEntry(',
  'task.abortController.signal',
  'scheduleSignalLiveTranslationRefresh(task)',
  "type: 'message.snapshot.request'",
  "forceCacheResult: task.mode === 'manual-refresh'",
  'setPendingSignalCacheRequest(task.appId',
  'cancelSignalLiveTranslationsForApp'
]) {
  assert.ok(liveTranslationQueue.includes(marker), `Signal live translation queue is missing: ${marker}`);
}
assert.match(
  liveTranslationQueue,
  /await lookupTranslationCache\(cacheRequest\)[\s\S]*?translateWithDeepSeek\(/,
  'an added message must query encrypted cache before it can call DeepSeek'
);
assert.match(
  liveTranslationQueue,
  /const forceRefresh = task\.mode === 'manual-refresh';[\s\S]*?if \(!forceRefresh\) \{[\s\S]*?lookupTranslationCache\(cacheRequest\)[\s\S]*?translateWithDeepSeek\(/,
  'manual refresh must bypass cache lookup and reach DeepSeek directly'
);
assert.match(
  liveTranslationQueue,
  /bypassNonEnglishContactGuard: forceRefresh/,
  'a canonical user-forced refresh must be allowed to replace an excluded-contact cache entry'
);
assert.match(
  liveTranslationQueue,
  /signalTranslationRefreshStates\.size > signalTranslationRefreshStateLimit/,
  'manual refresh cooldown and revision state must remain bounded'
);
assert.match(
  liveTranslationQueue,
  /cancelSignalLiveTranslationsForMessage\([\s\S]*?refreshRevision: revision/,
  'a newer accepted refresh must cancel stale work and carry the current per-message revision'
);
assert.match(
  liveTranslationQueue,
  /await saveTranslationCacheEntry\([\s\S]*?scheduleSignalLiveTranslationRefresh\(task\)/,
  'a live translation must reach encrypted cache storage before Signal is asked to refresh'
);
assert.match(
  liveTranslationQueue,
  /retryDelay === undefined \|\| !isSignalLiveTranslationEligible\(task\)/,
  'failed work must not retry after the authenticated visible conversation gate closes'
);
assert.match(
  liveTranslationQueue,
  /const cachedEntries = await lookupTranslationCache\(cacheRequest\);[\s\S]*?if \(!isSignalLiveTranslationEligible\(task\)\) return;[\s\S]*?translateWithDeepSeek\(/,
  'the authenticated visibility gate must be rechecked after cache lookup and before network use'
);
assert.match(
  liveTranslationQueue,
  /signalLiveTranslationRunningTasks[\s\S]*?task\.abortController\.abort\(\)/,
  'lifecycle cancellation must abort in-flight Signal translation requests'
);
assert.doesNotMatch(
  liveTranslationQueue,
  /console\.|appendTranslateRequestLog|sourceText\s*[,)]\s*(?:message|error)|translatedText\s*[,)]\s*(?:message|error)/,
  'the queue must not log source or translated message bodies'
);

const deepSeekTranslator = sourceBetween(
  main,
  'async function translateWithDeepSeek(',
  '\nfunction toggleMainWindowSize(',
  'DeepSeek translator'
);
const contentFreeLogBase = sourceBetween(
  deepSeekTranslator,
  "const logBase = logPolicy === 'content-free'\n    ? {",
  '\n    : {',
  'content-free translation log projection'
);
assert.doesNotMatch(
  contentFreeLogBase,
  /requestId|userId|textHash|sourceHash|textLength|profileId|profileName|messageKey|contactId|contactTitle|request\.text/,
  'source-native Signal translation logs must omit bodies, hashes, IDs, profiles, and contacts'
);

const controlContext = sourceBetween(
  main,
  'function getSignalCacheControlContext(',
  '\nfunction appendSignalCacheResultWithinProtocolLimit(',
  'Signal cache control gate'
);
for (const marker of [
  'appId !== signalAppId(profileId)',
  'signalControlClients.get(appId)',
  'client.socket.destroyed',
  'workspaceVisibilityGate.locked',
  'visibleSignalProfileId !== profileId',
  'bounds?.visible !== true',
  '!canShowSignalWindows()'
]) {
  assert.ok(controlContext.includes(marker), `Signal cache control gate is missing: ${marker}`);
}

const handler = sourceBetween(
  main,
  'function handleSignalControlMessage(',
  '\nasync function persistSignalControlStatus(',
  'Signal control message handler'
);
for (const marker of [
  "message.type === 'conversation.changed'",
  "message.type === 'message.added'",
  "message.type === 'translation.refresh.request'",
  "type: 'message.snapshot.request'",
  "message.type === 'message.visibleBatch'",
  "message.type === 'translation.cacheResultApplied'",
  'pending.conversationId === batch.conversationId',
  "pending?.state === 'pending'",
  'tryAcquireSignalCacheLookupSlot(appId)',
  "pending.state = 'responding'",
  "pending.state = 'completed'",
  'sendEmptySignalCacheResultBatch(appId, batch.requestId, batch.conversationId)',
  'activeSignalCacheConversations.get(appId)',
  'getPendingSignalCacheRequest(appId, batch.requestId)',
  'setPendingSignalCacheRequest(appId, candidate)'
]) {
  assert.ok(handler.includes(marker), `Signal cache response flow is missing: ${marker}`);
}
assert.match(
  handler,
  /message\.type === 'message\.added'[\s\S]*?activeConversation\?\.client !== cacheContext\.client[\s\S]*?activeConversation\.conversationId !== added\.conversationId[\s\S]*?else if \(added && cacheContext\)[\s\S]*?enqueueSignalLiveTranslation\(/,
  'only an authenticated added message for the active conversation may enter the live queue'
);
assert.match(
  handler,
  /message\.type === 'translation\.refresh\.request'[\s\S]*?validateSignalTranslationRefreshRequest\(message\)[\s\S]*?activeConversation\?\.client === cacheContext\.client[\s\S]*?activeConversation\.conversationId === refresh\.conversationId[\s\S]*?enqueueSignalTranslationRefresh\(/,
  'source-native refresh must require the authenticated active visible conversation'
);
const refreshHandlerStart = handler.indexOf("message.type === 'translation.refresh.request'");
assert.ok(refreshHandlerStart >= 0, 'source-native refresh handler is missing');
assert.doesNotMatch(
  handler.slice(Math.max(0, refreshHandlerStart - 120), refreshHandlerStart),
  /signalSourceOnlyAcceptanceActive/,
  'the production source-native refresh path must not depend on the development acceptance flag'
);
assert.doesNotMatch(handler, /message\.profileId/, 'Signal profileId must be derived from authenticated appId, never accepted from the payload');
assert.doesNotMatch(
  handler,
  /type: 'error'|Signal translation cache is busy/,
  'capacity rejection must remain a protocol-valid empty cache result, not an invalid error command'
);

const envelopeVerifier = sourceBetween(
  main,
  'function verifySignalControlEnvelope(',
  '\nfunction sendSignalControlMessage(',
  'Signal control envelope verifier'
);
const macVerificationIndex = envelopeVerifier.indexOf(
  'constantTimeBase64UrlEqual(envelope.mac, expectedMac)'
);
const metadataStripIndex = envelopeVerifier.indexOf(
  'stripSignalControlTransportMetadata(envelope.payload, appId)'
);
const sequenceCommitIndex = envelopeVerifier.indexOf(
  'client.receiveSequence = expectedSequence'
);
assert.ok(macVerificationIndex >= 0, 'Signal envelope must verify its MAC');
assert.ok(
  metadataStripIndex > macVerificationIndex,
  'transport metadata may only be inspected and stripped after the full payload MAC is verified'
);
assert.ok(
  sequenceCommitIndex > metadataStripIndex,
  'invalid transport metadata must not commit the receive sequence'
);
assert.match(
  envelopeVerifier,
  /expectedMac = signalControlMac\(client\.key, \[[\s\S]*?envelope\.payload[\s\S]*?\]\)/,
  'the MAC must continue to cover the original payload including transport metadata'
);
assert.match(
  handler,
  /activeConversation\.conversationId === batch\.conversationId[\s\S]*?if \(!pending\)[\s\S]*?setPendingSignalCacheRequest\(appId, candidate\)/,
  'each new visible batch in the active conversation must receive its own bounded request marker'
);
assert.match(
  main,
  /signalCachePendingRequestLimit = 128[\s\S]*?requests\.size >= signalCachePendingRequestLimit[\s\S]*?request\.state === 'completed'/,
  'request replay correlation must remain bounded and evict completed work first'
);
assert.match(
  main,
  /signalCacheInFlightRequestLimit = 8[\s\S]*?count >= signalCacheInFlightRequestLimit[\s\S]*?releaseSignalCacheLookupSlot/,
  'actual asynchronous cache lookup work must remain independently bounded per app'
);
assert.match(
  main,
  /Keep the bounded request marker after completion so the same requestId cannot[\s\S]*?function handleSignalControlMessage/,
  'completed request markers must remain bounded per app to reject replay'
);

const workspaceVisibility = sourceBetween(
  main,
  'async function setSignalWorkspaceBounds(',
  '\nasync function hideSignalProfile(',
  'Signal cache pending-request visibility lifecycle'
);
assert.match(
  workspaceVisibility,
  /visibleSignalProfileId !== profileId\) clearAllSignalCacheRequestState\(\)/,
  'switching visible Signal profiles must clear pending cache snapshot requests'
);
assert.match(
  workspaceVisibility,
  /clearSignalCacheRequestState\(signalAppId\(profileId\)\)/,
  'hiding a Signal profile through workspace bounds must clear its pending request'
);
assert.match(
  main,
  /if \(locked\) \{[\s\S]*?clearAllSignalCacheRequestState\(\);[\s\S]*?hideAllSignalWindows\(\);/,
  'locking the workspace must clear pending cache snapshot requests'
);

console.log('signal-cache-response-contract: pure validators and main-process cache response contracts passed');
