/* Local outbox shared by the two POI pages on the same origin. */
(function () {
  'use strict';
  // The installed iCloud script returns only to the owner's canonical site.
  if (location.origin !== 'https://4jh75v7tt6-ctrl.github.io' || !/^\/poi(?:\/|$)/.test(location.pathname)) {
    const localStatus = () => {
      const field = document.getElementById('poi-icloud-status');
      if (field) field.textContent = 'Données locales. Utilisez les boutons d’export pour conserver vos essais.';
      document.querySelectorAll('[data-poi-native-link]').forEach(link => { link.hidden = true; });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',localStatus);
    else localStatus();
    return;
  }
  const prefix = 'poi-icloud-outbox-v1:';
  const returnKey = 'poi-icloud-return:';
  const nativeURL = 'scriptable:///run/POI_Work_iCloud';
  let connected = false;
  let note = '';

  function ids() {
    return Object.keys(localStorage).filter(key => key.startsWith(prefix)).sort();
  }

  function paint() {
    const status = document.getElementById('poi-icloud-status');
    if (!status) return;
    let pending;
    try { pending = ids().length; } catch (_) {
      status.textContent = 'Stockage local indisponible. Exportez votre travail avant de fermer.';
      return;
    }
    const label = pending ? pending + ' envoi(s) en attente.' : 'File de sauvegarde vide.';
    status.textContent = [note, pending || connected ? label : '', connected ? 'Classement iCloud actif.' : (pending ? 'À transmettre depuis ce navigateur.' : 'Sauvegarde automatique disponible dans Scriptable.')].filter(Boolean).join(' ');
    document.querySelectorAll('[data-poi-native-link]').forEach(link => { link.hidden = connected; });
    if (pending && !connected) {
      const transfer = document.createElement('button');
      transfer.type = 'button';
      transfer.textContent = 'Classer les envois via le presse-papiers et Scriptable';
      transfer.onclick = () => handoff().catch(error => { note = error.message; paint(); });
      status.append(' ', transfer);
      const label = document.createElement('label');
      label.textContent = ' Relire un reçu de classement ';
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'application/json,.json';
      input.onchange = async () => {
        try {
          if (!input.files.length || input.files[0].size > 32000) throw Error('Choisissez un reçu de classement JSON.');
          applyReceipt(JSON.parse(await input.files[0].text())); paint();
        } catch (error) { note = error.message; paint(); }
      };
      label.appendChild(input); status.appendChild(label);
    }
  }

  function enqueue(files) {
    const id = Date.now() + '-' + crypto.randomUUID();
    const data = JSON.stringify({ id, files });
    if (data.length > 5000000) throw Error('Envoi trop volumineux. Utilisez l’export de fichier.');
    try { localStorage.setItem(prefix + id, data); }
    catch (_) { throw Error('File de sauvegarde pleine ou indisponible. Conservez un export manuel.'); }
    note = ''; paint();
    return id;
  }

  // Safari and Scriptable can have different website data stores. No work text is put in a URL.
  async function handoff() {
    const keys = ids();
    if (!keys.length) return;
    const jobs = [];
    let total = 0;
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      if (jobs.length >= 100 || total + raw.length > 5000000) break;
      jobs.push(JSON.parse(raw)); total += raw.length;
    }
    if (!jobs.length) throw Error('Aucun envoi transférable.');
    const token = crypto.randomUUID();
    const pending = jobs.map(job => job.id);
    const view = /\/work-training(?:\.html)?$/.test(location.pathname) ? 'work' : 'github';
    localStorage.setItem(returnKey + token, JSON.stringify(pending));
    await navigator.clipboard.writeText(JSON.stringify({ schema: 'poi.icloud-handoff.v1', token, jobs }));
    location.href = nativeURL + '?view=' + view + '&handoff=' + token;
  }

  function applyReceipt(receipt) {
    if (!receipt || receipt.schema !== 'poi.icloud-receipt.v1' ||
        !/^[0-9a-f-]{36}$/i.test(receipt.token) || !Array.isArray(receipt.saved) ||
        receipt.saved.length > 100) throw Error('Format du reçu de classement inconnu.');
    const key = returnKey + receipt.token;
    const raw = localStorage.getItem(key);
    if (!raw) throw Error('Ouvrez ce reçu depuis le navigateur ou l’icône qui a transmis la file.');
    const pending = new Set(JSON.parse(raw)), saved = new Set(receipt.saved);
    if (saved.size !== receipt.saved.length || !receipt.saved.every(id => pending.has(id))) {
      throw Error('Le reçu ne correspond pas au lot transmis.');
    }
    for (const id of saved) localStorage.removeItem(prefix + id);
    localStorage.removeItem(key);
    note = saved.size + ' envoi(s) confirmé(s) par le reçu iCloud.';
  }

  function acceptReturn() {
    if (location.hash.startsWith('#poi-receipt=')) {
      try { applyReceipt(JSON.parse(decodeURIComponent(location.hash.slice(13)))); }
      catch (error) { note = error.message; }
      history.replaceState(null, '', location.pathname + location.search);
      return;
    }
    const token = location.hash.match(/^#poi-saved=([0-9a-f-]{36})$/i);
    if (!token) return;
    const key = returnKey + token[1];
    const raw = localStorage.getItem(key);
    if (raw) {
      for (const id of JSON.parse(raw)) localStorage.removeItem(prefix + id);
      localStorage.removeItem(key);
      note = 'Envois relus sur l’iPhone dans le dossier iCloud autorisé.';
    }
    history.replaceState(null, '', location.pathname + location.search);
  }

  window.POIiCloud = Object.freeze({
    saveWork(corpus, diagnostic) { return enqueue({ corpus, diagnostic }); },
    saveTransfer(transfer) { return enqueue({ transfer }); },
    saveGithubResult(github) { return enqueue({ github }); },
    restoreTransfer(latest) {
      const transferKey = 'poi-work-transfer-v1';
      const seen = 'poi-icloud-reviewed-file-v1';
      if (localStorage.getItem(seen) === latest.name) return;
      const encoded = JSON.stringify(latest.data);
      const pending = localStorage.getItem(transferKey);
      if (!pending) {
        localStorage.setItem(transferKey, encoded);
        window.dispatchEvent(new StorageEvent('storage', { key: transferKey }));
      }
      if (!pending || pending === encoded) localStorage.setItem(seen, latest.name);
    },
    openNative(view) { location.href = nativeURL + (view === 'github' ? '?view=github' : ''); },
    next() {
      if (!connected) { connected = true; paint(); }
      const key = ids()[0];
      return key ? localStorage.getItem(key) : null;
    },
    acknowledge(id) {
      localStorage.removeItem(prefix + id);
      note = 'Fichiers relus sur l’iPhone dans le dossier iCloud autorisé.'; paint();
    },
    error(message) { note = message; paint(); }
  });

  function ready() { try { acceptReturn(); } catch (_) {} paint(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
  window.addEventListener('storage', paint);
  window.addEventListener('hashchange', ready);
}());
