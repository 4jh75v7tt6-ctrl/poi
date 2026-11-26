// Variables used by Scriptable.
// icon-color: deep-blue; icon-glyph: cloud;
// Raccourci iPhone pour les deux pages POI et le classement iCloud.
const BASE = 'https://4jh75v7tt6-ctrl.github.io/poi/';
const targets = {
  corpus: ['07_STAGING/TO_VALIDATE', 'POI_WORK_LANGAGE_CORRECTIONS', 'poi.work-language.v1'],
  transfer: ['07_STAGING/TO_VALIDATE', 'POI_WORK_TRANSFERT', 'poi.work-transfer.v1'],
  diagnostic: ['05_EVIDENCE/TEST_RESULTS', 'POI_WORK_LANGAGE_DIAGNOSTIC', 'poi.work-diagnostic.v1'],
  github: ['05_EVIDENCE/TEST_RESULTS', 'POI_GITHUB_DIAGNOSTIC', 'poi.github-diagnostic.v1']
};
const jobId = /^\d{13}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function findRoot(fm) {
  for (const bookmark of fm.allFileBookmarks()) {
    if (bookmark.source !== 'host') continue;
    try {
      let root = fm.bookmarkedPath(bookmark.name).replace(/\/$/, '');
      if (root.endsWith('/IA')) root = fm.joinPath(root, 'POI_Beta1');
      if (root.endsWith('/IA/POI_Beta1') && fm.isDirectory(root) && fm.isFileStoredIniCloud(root)
          && Object.values(targets).every(([dir]) => fm.isDirectory(fm.joinPath(root, dir)))) return root;
    } catch (_) { /* A bookmark to another provider may be unavailable. */ }
  }
  throw Error('Dans les réglages de Scriptable, ouvrez File Bookmarks et ajoutez le dossier iCloud Drive/IA/POI_Beta1 avec le nom de votre choix. Relancez ensuite ce script.');
}

function parts(job) {
  if (!job || !jobId.test(job.id) || !job.files || Array.isArray(job.files)) throw Error('Envoi POI invalide.');
  const keys = Object.keys(job.files).sort().join(',');
  if (!['corpus,diagnostic','transfer','github'].includes(keys)) throw Error('Type de lot inconnu.');
  return Object.entries(job.files).map(([kind, value]) => {
    const [dir, name, schema] = targets[kind];
    if (!value || value.schema !== schema) throw Error('Schéma de fichier invalide.');
    const records = kind === 'transfer' ? value.proposals : value.records;
    if (['corpus','transfer'].includes(kind) && (!Array.isArray(records) || records.length > 10000)) throw Error('Lot de consignes invalide.');
    return { dir, name: name + '_' + job.id + '.json', text: JSON.stringify(value) };
  });
}

async function saveJob(fm, root, job) {
  const local = FileManager.local();
  for (const part of parts(job)) {
    const path = fm.joinPath(fm.joinPath(root, part.dir), part.name);
    if (!fm.fileExists(path)) {
      const temp = local.joinPath(local.temporaryDirectory(), 'poi-' + UUID.string() + '.tmp');
      try {
        local.writeString(temp, part.text);
        // copy fails if another writer already published this filename.
        try { fm.copy(temp, path); } catch (error) { if (!fm.fileExists(path)) throw error; }
      } finally { if (local.fileExists(temp)) local.remove(temp); }
    }
    await fm.downloadFileFromiCloud(path);
    if (fm.readString(path) !== part.text) throw Error('Le contenu relu diffère. L’envoi reste en attente.');
  }
}

async function latestFile(fm, root, kind) {
  const [dir, stem, schema] = targets[kind];
  const stage = fm.joinPath(root, dir);
  const names = fm.listContents(stage);
  const versions = names.filter(name => name.startsWith(stem + '_') && name.endsWith('.json')
    && jobId.test(name.slice(stem.length + 1, -5))).sort().reverse();
  if (kind === 'corpus' && names.includes('POI_WORK_LANGAGE_CORRECTIONS_V1.json')) versions.push('POI_WORK_LANGAGE_CORRECTIONS_V1.json');
  for (const name of versions) {
    const path = fm.joinPath(stage,name);
    await fm.downloadFileFromiCloud(path);
    const data = JSON.parse(fm.readString(path));
    if (data.schema !== schema) throw Error('Schéma inattendu dans ' + name);
    if (kind === 'corpus' && Array.isArray(data.records) && !data.records.length) continue;
    return {name,data};
  }
  return null;
}

async function displayError(message) {
  const dialog = new Alert(); dialog.title = 'Sauvegarde POI'; dialog.message = message;
  dialog.addAction('Fermer'); await dialog.presentAlert();
}

async function run() {
  const fm = FileManager.iCloud();
  const root = findRoot(fm);
  const params = args.queryParameters || {};
  const page = params.view === 'github' ? 'index.html' : 'work-training.html';

  if (params.handoff) {
    if (!/^[a-f0-9-]{36}$/i.test(params.handoff)) throw Error('Transfert non reconnu.');
    const raw = Pasteboard.pasteString();
    if (!raw || raw.length > 5100000) throw Error('Transfert absent ou trop volumineux.');
    const pack = JSON.parse(raw);
    if (pack.schema !== 'poi.icloud-handoff.v1' || pack.token !== params.handoff || !Array.isArray(pack.jobs) || !pack.jobs.length || pack.jobs.length > 100) throw Error('Le presse-papiers ne correspond plus au transfert demandé.');
    const receipt = {schema:'poi.icloud-receipt.v1', token:pack.token, saved:[]};
    let failed = '';
    for (const job of pack.jobs) {
      try { await saveJob(fm,root,job); receipt.saved.push(job.id); }
      catch (error) { failed = String(error.message || error); break; }
    }
    const filename = 'POI_RECU_CLASSEMENT_' + pack.token + '.json';
    const receiptPath = fm.joinPath(fm.joinPath(root,targets.diagnostic[0]),filename);
    const encoded = JSON.stringify(receipt);
    fm.writeString(receiptPath,encoded);
    await fm.downloadFileFromiCloud(receiptPath);
    if (fm.readString(receiptPath) !== encoded) throw Error('Relecture du reçu impossible.');
    if (Pasteboard.pasteString() === raw) Pasteboard.copyString('');
    if (failed) await displayError(receipt.saved.length + ' envoi(s) relu(s). Reprendre les suivants. ' + failed);
    Safari.open(BASE + page + '#poi-receipt=' + encodeURIComponent(encoded));
    return;
  }

  const web = new WebView();
  await web.loadURL(BASE + page);
  // Evaluate the origin and page path on every call, including after a navigation.
  const allowed = "location.origin === 'https://4jh75v7tt6-ctrl.github.io' && ['/poi','/poi/','/poi/index','/poi/index.html','/poi/work-training','/poi/work-training.html'].includes(location.pathname)";
  function evaluate(code) { return web.evaluateJavaScript('(' + allowed + ') ? (' + code + ') : null', false); }

  if (!await evaluate("!!window.POIiCloud && typeof POIiCloud.next === 'function'")) {
    throw Error('La page POI chargée ne présente pas le module de sauvegarde iCloud. Vérifiez la connexion et la version publiée puis relancez le raccourci.');
  }
  let busy = false, retryAfter = 0, restored = false;
  async function pump() {
    if (busy || Date.now() < retryAfter) return;
    busy = true;
    try {
      const raw = await evaluate('window.POIiCloud ? POIiCloud.next() : null');
      if (raw) {
        if (typeof raw !== 'string' || raw.length > 5000000) throw Error('Taille de lot invalide.');
        const job = JSON.parse(raw);
        await saveJob(fm, root, job);
        await evaluate('window.POIiCloud && POIiCloud.acknowledge(' + JSON.stringify(job.id) + ')');
      } else if (!restored && await evaluate("typeof window.poiRestoreWork === 'function'")) {
        const corpus = await latestFile(fm, root, 'corpus');
        if (corpus) await evaluate('window.poiRestoreWork && window.poiRestoreWork(' + JSON.stringify(corpus.data) + ')');
        const latest = await latestFile(fm, root, 'transfer');
        if (latest) await evaluate('window.POIiCloud && POIiCloud.restoreTransfer(' + JSON.stringify(latest) + ')');
        restored = true;
      }
    } catch (error) {
      retryAfter = Date.now() + 15000;
      try { await evaluate('window.POIiCloud && POIiCloud.error(' + JSON.stringify('Sauvegarde à reprendre. ' + error.message) + ')'); } catch (_) {}
    } finally { busy = false; }
  }

  await pump();
  const timer = Timer.schedule(1000, true, pump);
  try { await web.present(false); } finally { timer.invalidate(); }
}

try { await run(); } catch (error) { await displayError(error.message); }
Script.complete();
