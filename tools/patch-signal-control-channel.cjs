const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const asar = require('@electron/asar');

async function main() {
  const cliArgs = process.argv.slice(2);
  const rebuildFromBackup = cliArgs.includes('--rebuild-from-backup');
  const exeHashOverride = cliArgs.find(value => value.startsWith('--exe-old-hash='))?.slice('--exe-old-hash='.length) || '';
  const runtimeDir = cliArgs.find(value => !value.startsWith('--')) || path.resolve('.runtime/signal-desktop');
  const exePath = path.join(runtimeDir, 'Signal.exe');
  const resourcesDir = path.join(runtimeDir, 'resources');
  const asarPath = path.join(resourcesDir, 'app.asar');
  const backupPath = path.join(resourcesDir, 'app.before-signal-control.asar');
  const unpackedPath = `${asarPath}.unpacked`;
  const backupUnpackedPath = `${backupPath}.unpacked`;
  const tempDir = path.resolve('.tmp/signal-control-asar');

  if (!fsSync.existsSync(exePath)) throw new Error(`Signal.exe was not found: ${exePath}`);
  if (!fsSync.existsSync(asarPath)) throw new Error(`app.asar was not found: ${asarPath}`);

  if (exeHashOverride && !/^[a-f0-9]{64}$/i.test(exeHashOverride)) throw new Error('Invalid --exe-old-hash value.');
  const oldHeaderHash = exeHashOverride || headerHash(asarPath);
  if (!fsSync.existsSync(backupPath)) {
    await fs.copyFile(asarPath, backupPath);
  }
  if (!fsSync.existsSync(backupUnpackedPath) && fsSync.existsSync(unpackedPath)) {
    await fs.cp(unpackedPath, backupUnpackedPath, { recursive: true });
  }
  if (rebuildFromBackup) {
    if (!fsSync.existsSync(backupPath)) throw new Error(`Signal backup app.asar was not found: ${backupPath}`);
    if (!fsSync.existsSync(backupUnpackedPath)) {
      throw new Error(`Signal backup app.asar.unpacked was not found: ${backupUnpackedPath}`);
    }
    await fs.copyFile(backupPath, asarPath);
    await fs.rm(unpackedPath, { recursive: true, force: true });
    await fs.cp(backupUnpackedPath, unpackedPath, { recursive: true });
  }

  await fs.rm(tempDir, { recursive: true, force: true });
  await asar.extractAll(asarPath, tempDir);

  let packageChanged = false;
  const changes = [];
  const packageJsonPath = path.join(tempDir, 'package.json');
  const guardConfigPath = path.join(tempDir, 'df-guard-config.json');
  const guardTargetPath = path.join(tempDir, 'df-bootstrap.cjs');
  const guardTemplatePath = path.resolve(__dirname, '..', 'signal-guard', 'df-bootstrap.cjs');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  let originalMain = packageJson.main;
  if (originalMain === 'df-bootstrap.cjs') {
    const guardConfig = JSON.parse(await fs.readFile(guardConfigPath, 'utf8'));
    originalMain = guardConfig.originalMain;
  }
  if (!originalMain || originalMain === 'df-bootstrap.cjs') {
    throw new Error('Signal original main entry could not be determined.');
  }
  const guardTemplate = await fs.readFile(guardTemplatePath, 'utf8');
  const guardSource = guardTemplate.replace(
    /^const ORIGINAL_MAIN = .*;$/m,
    `const ORIGINAL_MAIN = ${JSON.stringify(`./${originalMain.replace(/^\.\//, '')}`)};`
  );
  if (await writeIfChanged(guardTargetPath, guardSource)) {
    packageChanged = true;
    changes.push('guard-source');
  }
  if (await writeIfChanged(
    guardConfigPath,
    `${JSON.stringify({ schemaVersion: 1, originalMain })}\n`
  )) {
    packageChanged = true;
    changes.push('guard-config');
  }
  if (packageJson.main !== 'df-bootstrap.cjs') {
    packageJson.main = 'df-bootstrap.cjs';
    await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
    packageChanged = true;
    changes.push('package-main');
  }

  const localProductionConfigPath = path.join(tempDir, 'config', 'local-production.json');
  let localProductionConfig = {};
  try {
    localProductionConfig = JSON.parse(await fs.readFile(localProductionConfigPath, 'utf8'));
  } catch {
    localProductionConfig = {};
  }
  if (localProductionConfig.updatesEnabled !== false) {
    localProductionConfig.updatesEnabled = false;
    await fs.writeFile(localProductionConfigPath, `${JSON.stringify(localProductionConfig)}\n`, 'utf8');
    packageChanged = true;
    changes.push('updates-disabled');
  }

  const mainPath = path.join(tempDir, 'bundles', 'main.js');
  let source = await fs.readFile(mainPath, 'utf8');
  const originalSource = source;
  if (!source.includes('Z=new f.BrowserWindow(g)')) {
    throw new Error('Signal BrowserWindow creation snippet was not found.');
  }

  if (!source.includes('__dfSignalProtocolGuard')) {
    source = source.replace(
      'let f=require(`electron`),',
      'let f=require(`electron`);if(process.argv.some(e=>e===`-Embedding`)&&!process.argv.some(e=>e===`--df`||e===`--windowMode=embed`)){try{globalThis.__dfSignalEmbeddingGuard=1;f.app.once(`ready`,()=>f.app.quit());setTimeout(()=>f.app.exit(0),1500)}catch{process.exit(0)}}if(process.argv.some(e=>e===`--df`||e===`--windowMode=embed`)){try{globalThis.__dfSignalProtocolGuard=1;f.app.setAsDefaultProtocolClient=()=>false;f.app.isDefaultProtocolClient=()=>true}catch{}}let '
    );
  } else if (!source.includes('__dfSignalEmbeddingGuard')) {
    source = source.replace(
      'let f=require(`electron`);if(process.argv.some(e=>e===`--df`||e===`--windowMode=embed`)){try{globalThis.__dfSignalProtocolGuard=1;',
      'let f=require(`electron`);if(process.argv.some(e=>e===`-Embedding`)&&!process.argv.some(e=>e===`--df`||e===`--windowMode=embed`)){try{globalThis.__dfSignalEmbeddingGuard=1;f.app.once(`ready`,()=>f.app.quit());setTimeout(()=>f.app.exit(0),1500)}catch{process.exit(0)}}if(process.argv.some(e=>e===`--df`||e===`--windowMode=embed`)){try{globalThis.__dfSignalProtocolGuard=1;'
    );
  }

  const injection = signalControlInjection();
  if (source.includes('__dfSignalControl') && !source.includes('__dfSignalControlAuthV1')) {
    const start = source.indexOf('(()=>{try{if(globalThis.__dfSignalControl');
    const legacyEndMarker = '}catch(e){try{X.warn(`DF Signal control failed`,e)}catch{}}})()';
    const end = start >= 0 ? source.indexOf(legacyEndMarker, start) : -1;
    if (start < 0 || end < 0) throw new Error('Existing Signal control injection could not be upgraded safely.');
    source = source.slice(0, start) + injection + source.slice(end + legacyEndMarker.length);
  }
  if (!source.includes('__dfSignalEmbedWindowOptions')) {
    source = source.replace(
      'Z=new f.BrowserWindow(g),',
      'process.argv.some(e=>e===`--df`||e===`--windowMode=embed`)&&(globalThis.__dfSignalEmbedWindowOptions=1,g.frame=false,g.hasShadow=false,g.thickFrame=false,g.autoHideMenuBar=true,g.skipTaskbar=true,g.titleBarStyle=`hidden`),Z=new f.BrowserWindow(g),Z&&process.argv.some(e=>e===`--df`||e===`--windowMode=embed`)&&(Z.setMenuBarVisibility&&Z.setMenuBarVisibility(false),Z.setAutoHideMenuBar&&Z.setAutoHideMenuBar(true),Z.setSkipTaskbar&&Z.setSkipTaskbar(true),Z.setHasShadow&&Z.setHasShadow(false)),'
    );
  } else if (!source.includes('g.hasShadow=false')) {
    source = source.replace(
      'globalThis.__dfSignalEmbedWindowOptions=1,g.frame=false,g.autoHideMenuBar=true,g.skipTaskbar=true,g.titleBarStyle=`hidden`',
      'globalThis.__dfSignalEmbedWindowOptions=1,g.frame=false,g.hasShadow=false,g.thickFrame=false,g.autoHideMenuBar=true,g.skipTaskbar=true,g.titleBarStyle=`hidden`'
    );
    source = source.replace(
      'Z.setSkipTaskbar&&Z.setSkipTaskbar(true))',
      'Z.setSkipTaskbar&&Z.setSkipTaskbar(true),Z.setHasShadow&&Z.setHasShadow(false))'
    );
  } else if (!source.includes('g.thickFrame=false')) {
    source = source.replace(
      'globalThis.__dfSignalEmbedWindowOptions=1,g.frame=false,g.hasShadow=false,g.autoHideMenuBar=true,g.skipTaskbar=true,g.titleBarStyle=`hidden`',
      'globalThis.__dfSignalEmbedWindowOptions=1,g.frame=false,g.hasShadow=false,g.thickFrame=false,g.autoHideMenuBar=true,g.skipTaskbar=true,g.titleBarStyle=`hidden`'
    );
  }
  if (!source.includes('__dfSignalControl')) {
    source = source.replace('Z=new f.BrowserWindow(g),', `Z=new f.BrowserWindow(g),${injection},`);
  } else if (!source.includes('window.focus')) {
    source = source.replace(
      /if\(m\.type===`window\.show`\)\{Z&&Z\.show\(\);send\(\{type:`window\.state`,visible:Z&&Z\.isVisible&&Z\.isVisible\(\)\}\);return\}/,
      'if(m.type===`window.show`){Z&&m.bounds&&Z.setBounds(m.bounds);Z&&Z.setAlwaysOnTop&&Z.setAlwaysOnTop(true);Z&&Z.show();Z&&Z.focus&&Z.focus();Z&&Z.moveTop&&Z.moveTop();Z&&Z.setAlwaysOnTop&&Z.setAlwaysOnTop(false);send({type:`window.state`,visible:Z&&Z.isVisible&&Z.isVisible(),bounds:Z&&Z.getBounds&&Z.getBounds()});return}if(m.type===`window.focus`&&Z){Z.setAlwaysOnTop&&Z.setAlwaysOnTop(true);Z.focus&&Z.focus();Z.moveTop&&Z.moveTop();Z.setAlwaysOnTop&&Z.setAlwaysOnTop(false);send({type:`window.state`,visible:Z.isVisible&&Z.isVisible(),bounds:Z.getBounds&&Z.getBounds()});return}'
    );
  }
  if (source.includes('__dfSignalControl') && !source.includes('setAlwaysOnTop&&Z.setAlwaysOnTop(true)')) {
    source = source
      .replace(
        'if(m.type===`window.show`){Z&&m.bounds&&Z.setBounds(m.bounds);Z&&Z.show();Z&&Z.focus&&Z.focus();Z&&Z.moveTop&&Z.moveTop();send({type:`window.state`,visible:Z&&Z.isVisible&&Z.isVisible(),bounds:Z&&Z.getBounds&&Z.getBounds()});return}',
        'if(m.type===`window.show`){Z&&m.bounds&&Z.setBounds(m.bounds);Z&&Z.setAlwaysOnTop&&Z.setAlwaysOnTop(true);Z&&Z.show();Z&&Z.focus&&Z.focus();Z&&Z.moveTop&&Z.moveTop();Z&&Z.setAlwaysOnTop&&Z.setAlwaysOnTop(false);send({type:`window.state`,visible:Z&&Z.isVisible&&Z.isVisible(),bounds:Z&&Z.getBounds&&Z.getBounds()});return}'
      )
      .replace(
        'if(m.type===`window.focus`&&Z){Z.focus&&Z.focus();Z.moveTop&&Z.moveTop();send({type:`window.state`,visible:Z.isVisible&&Z.isVisible(),bounds:Z.getBounds&&Z.getBounds()});return}',
        'if(m.type===`window.focus`&&Z){Z.setAlwaysOnTop&&Z.setAlwaysOnTop(true);Z.focus&&Z.focus();Z.moveTop&&Z.moveTop();Z.setAlwaysOnTop&&Z.setAlwaysOnTop(false);send({type:`window.state`,visible:Z.isVisible&&Z.isVisible(),bounds:Z.getBounds&&Z.getBounds()});return}'
      )
      .replace(
        'if(m.type===`protocol.open`&&typeof m.url===`string`&&Z){Z.show();Z.focus&&Z.focus();Z.moveTop&&Z.moveTop();',
        'if(m.type===`protocol.open`&&typeof m.url===`string`&&Z){Z.setAlwaysOnTop&&Z.setAlwaysOnTop(true);Z.show();Z.focus&&Z.focus();Z.moveTop&&Z.moveTop();Z.setAlwaysOnTop&&Z.setAlwaysOnTop(false);'
      );
  }
  if (source.includes('__dfSignalControl') && !source.includes('__dfSignalControlSend')) {
    source = source.replace(
      'const send=o=>{try{if(ws&&ws.readyState===1)ws.send(JSON.stringify(Object.assign({appId,at:Date.now()},o)))}catch{}};',
      'const send=o=>{try{if(ws&&ws.readyState===1)ws.send(JSON.stringify(Object.assign({appId,at:Date.now()},o)))}catch{}};globalThis.__dfSignalControlSend=send;'
    );
  }
  if (source.includes('__dfSignalControl') && !source.includes('window.group-focused')) {
    source = source.replace(
      'Z.on(`show`,()=>send({type:`window.state`,visible:true,bounds:Z.getBounds()}));',
      'Z.on(`focus`,()=>send({type:`window.group-focused`}));Z.on(`blur`,()=>send({type:`window.group-blurred`}));Z.on(`show`,()=>send({type:`window.state`,visible:true,bounds:Z.getBounds()}));'
    );
  }
  if (!source.includes('DF Signal embed: skip sgnl protocol registration')) {
    source = source.replace(
      'f.app.isDefaultProtocolClient(`sgnl`)?X.info(`signal is already registered as the default app for the sgnl url scheme.`):(X.info(`setting signal as the default app for the sgnl url scheme`),f.app.setAsDefaultProtocolClient(`sgnl`))',
      'process.argv.some(e=>e===`--df`||e===`--windowMode=embed`)?X.info(`DF Signal embed: skip sgnl protocol registration`):f.app.isDefaultProtocolClient(`sgnl`)?X.info(`signal is already registered as the default app for the sgnl url scheme.`):(X.info(`setting signal as the default app for the sgnl url scheme`),f.app.setAsDefaultProtocolClient(`sgnl`))'
    );
  }
  if (!source.includes('DF Signal embed: skip signalcaptcha protocol registration')) {
    source = source.replace(
      'f.app.isDefaultProtocolClient(`signalcaptcha`)?X.info(`signal is already registered as the default app for the sgnl url scheme.`):(X.info(`setting signal as the default app for the signalcaptcha url scheme`),f.app.setAsDefaultProtocolClient(`signalcaptcha`))',
      'process.argv.some(e=>e===`--df`||e===`--windowMode=embed`)?X.info(`DF Signal embed: skip signalcaptcha protocol registration`):f.app.isDefaultProtocolClient(`signalcaptcha`)?X.info(`signal is already registered as the default app for the sgnl url scheme.`):(X.info(`setting signal as the default app for the signalcaptcha url scheme`),f.app.setAsDefaultProtocolClient(`signalcaptcha`))'
    );
  }
  source = source.replace(
    'if(s===t.t.Message||s===t.t.Reaction)u=t.y.toAppUrl({token:o}),d=(0,Ey.jsx)(Ny,{src:`ms-winsoundevent:Notification.IM`});',
    'if(s===t.t.Message||s===t.t.Reaction)u=t.y.toAppUrl({token:o}),globalThis.__dfSignalControlSend&&globalThis.__dfSignalControlSend({type:`notification.token`,token:o}),d=(0,Ey.jsx)(Ny,{src:`ms-winsoundevent:Notification.IM`});'
  );
  source = source.replace(
    '(0,Ey.jsxs)(Oy,{launch:u.href,activationType:`protocol`,children:[',
    '(0,Ey.jsxs)(Oy,{...(process.argv.some(e=>e===`--df`||e===`--windowMode=embed`)?{}:{launch:u.href,activationType:`protocol`}),children:['
  );

  if (source !== originalSource) {
    await fs.writeFile(mainPath, source, 'utf8');
    packageChanged = true;
    changes.push('main-bundle');
  }

  if (packageChanged) {
    await fs.rm(asarPath, { force: true });
    await fs.rm(`${asarPath}.unpacked`, { recursive: true, force: true });
    await asar.createPackageWithOptions(tempDir, asarPath, {
      unpack: '*.node',
      unpackDir: 'build/icons/win'
    });
  }

  const newHeaderHash = headerHash(asarPath);
  if (oldHeaderHash !== newHeaderHash) {
    patchExeHash(exePath, oldHeaderHash, newHeaderHash);
  }

  console.log(JSON.stringify({
    runtimeDir,
    patched: true,
    rebuildFromBackup,
    usedExeHashOverride: Boolean(exeHashOverride),
    changes,
    oldHeaderHash,
    newHeaderHash
  }, null, 2));
}

function headerHash(asarPath) {
  const rawHeader = asar.getRawHeader(asarPath);
  return crypto.createHash('sha256').update(rawHeader.headerString).digest('hex');
}

function patchExeHash(exePath, oldHash, newHash) {
  const exe = fsSync.readFileSync(exePath);
  const from = Buffer.from(oldHash, 'utf8');
  const to = Buffer.from(newHash, 'utf8');
  const index = exe.indexOf(from);
  if (index < 0) {
    throw new Error(`Old app.asar header hash was not found in Signal.exe: ${oldHash}`);
  }
  to.copy(exe, index);
  fsSync.writeFileSync(exePath, exe);
}

async function writeIfChanged(targetPath, value) {
  try {
    if (await fs.readFile(targetPath, 'utf8') === value) return false;
  } catch {
    // A missing generated file is written below.
  }
  await fs.writeFile(targetPath, value, 'utf8');
  return true;
}

function signalControlInjection() {
  return `(()=>{try{
    if(globalThis.__dfSignalControl)return;
    globalThis.__dfSignalControl=1;
    globalThis.__dfSignalControlAuthV1=1;
    const q=process.argv||[];
    const ga=n=>{const p=q.find(e=>e===n||e.startsWith(n+'='));return p&&p.includes('=')?p.slice(n.length+1):p?'1':''};
    const appId=ga('--appId'),wsPort=ga('--wsPort'),mode=ga('--windowMode');
    const keyText=process.env.MAOYI_SIGNAL_CONTROL_KEY||'';
    delete process.env.MAOYI_SIGNAL_CONTROL_KEY;
    const controlKey=Buffer.from(keyText,'base64url');
    if(!appId||!wsPort||mode!=='embed'||controlKey.length!==32)return;
    const C=require('node:crypto');
    const mac=values=>C.createHmac('sha256',controlKey).update(JSON.stringify(values)).digest('base64url');
    const equal=(a,b)=>{try{const x=Buffer.from(a||'','base64url'),y=Buffer.from(b||'','base64url');return x.length===y.length&&C.timingSafeEqual(x,y)}catch{return false}};
    try{Z.setMenuBarVisibility&&Z.setMenuBarVisibility(false);Z.setAutoHideMenuBar&&Z.setAutoHideMenuBar(true);Z.setSkipTaskbar&&Z.setSkipTaskbar(true)}catch{}
    const W=globalThis.WebSocket;
    if(!W){try{X.warn('DF Signal control: WebSocket unavailable')}catch{}return}
    let ws,timer,authenticated=false,sendSequence=0,receiveSequence=0;
    const rawSend=o=>{try{if(ws&&ws.readyState===1)ws.send(JSON.stringify(o))}catch{}};
    const send=o=>{if(!authenticated)return;const payload=Object.assign({appId,at:Date.now()},o),sequence=++sendSequence;rawSend({version:1,sequence,payload,mac:mac(['maoyi-signal-control-message-v1','signal-to-main',appId,process.pid,sequence,payload])})};
    globalThis.__dfSignalControlSend=send;
    const raise=()=>{try{Z.setAlwaysOnTop&&Z.setAlwaysOnTop(true);Z.show();Z.focus&&Z.focus();Z.moveTop&&Z.moveTop();Z.setAlwaysOnTop&&Z.setAlwaysOnTop(false)}catch{}};
    const run=async m=>{try{
      if(m.type==='window.show'){Z&&m.bounds&&Z.setBounds(m.bounds);Z&&raise();send({type:'window.state',visible:Z&&Z.isVisible&&Z.isVisible(),bounds:Z&&Z.getBounds&&Z.getBounds()});return}
      if(m.type==='window.focus'&&Z){raise();send({type:'window.state',visible:Z.isVisible&&Z.isVisible(),bounds:Z.getBounds&&Z.getBounds()});return}
      if(m.type==='window.hide'){Z&&Z.hide();send({type:'window.state',visible:Z&&Z.isVisible&&Z.isVisible()});return}
      if(m.type==='window.bounds-changed'&&m.bounds&&Z){Z.isMaximized&&Z.isMaximized()&&Z.unmaximize&&Z.unmaximize();for(const k in m.bounds)m.bounds[k]=Math.round(m.bounds[k]);Z.setBounds(m.bounds);send({type:'window.bounds',bounds:Z.getBounds()});return}
      if(m.type==='protocol.open'&&typeof m.url==='string'&&Z){raise();try{f.app.emit('open-url',{preventDefault(){},defaultPrevented:false},m.url)}catch(e){send({type:'error',requestId:m.requestId,message:e&&e.message?e.message:String(e)})}send({type:'protocol.opened',url:m.url});return}
      if(m.type==='shutdown'){send({type:'shutdown.ack'});f.app.quit();return}
      if(m.type==='script.execute'&&typeof m.script==='string'&&Z){const r=await Z.webContents.executeJavaScript(m.script,true);send({type:'script.result',requestId:m.requestId,result:r});return}
    }catch(e){send({type:'error',requestId:m&&m.requestId,message:e&&e.message?e.message:String(e)})}};
    const receive=e=>{try{
      const m=JSON.parse(e.data);
      if(!authenticated){
        if(m.type!=='auth.challenge'||typeof m.challenge!=='string'){ws.close();return}
        rawSend({type:'auth.response',processId:process.pid,mac:mac(['maoyi-signal-control-auth-v1',appId,process.pid,m.challenge])});
        authenticated=true;
        send({type:'ready',title:Z&&Z.getTitle&&Z.getTitle(),bounds:Z&&Z.getBounds&&Z.getBounds()});
        clearInterval(timer);timer=setInterval(()=>send({type:'heartbeat',visible:Z&&Z.isVisible&&Z.isVisible()}),5000);
        return;
      }
      const expected=receiveSequence+1;
      if(m.version!==1||m.sequence!==expected||!m.payload||!equal(m.mac,mac(['maoyi-signal-control-message-v1','main-to-signal',appId,process.pid,m.sequence,m.payload]))){ws.close();return}
      receiveSequence=expected;run(m.payload);
    }catch{ws.close()}};
    const connect=()=>{try{
      authenticated=false;sendSequence=0;receiveSequence=0;
      ws=new W('ws://127.0.0.1:'+wsPort+'?appId='+encodeURIComponent(appId));
      ws.onmessage=receive;
      ws.onclose=()=>{authenticated=false;clearInterval(timer);setTimeout(connect,1000)};
      ws.onerror=()=>{};
    }catch{setTimeout(connect,1000)}};
    connect();
    Z.on('focus',()=>send({type:'window.group-focused'}));
    Z.on('blur',()=>send({type:'window.group-blurred'}));
    Z.on('show',()=>send({type:'window.state',visible:true,bounds:Z.getBounds()}));
    Z.on('hide',()=>send({type:'window.state',visible:false,bounds:Z.getBounds()}));
    Z.on('resize',()=>send({type:'window.bounds',bounds:Z.getBounds()}));
    Z.on('move',()=>send({type:'window.bounds',bounds:Z.getBounds()}));
    Z.on('closed',()=>{clearInterval(timer);send({type:'closed'})});
  }catch(e){try{X.warn('DF Signal control failed',e)}catch{}}})()`;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
