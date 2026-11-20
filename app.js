(function () {
  'use strict';
  var Core = window.POICore;
  var Exporter = window.POIExport;
  var Docs = window.POIDocuments;
  var APP_VERSION = '0.2.0';
  var state, db = null, storageMode = 'memory', saveQueue = Promise.resolve();
  var saveRevision = 0, writeBlocked = false, lastSavedAt = null, lastStorageError = null, lastValidSnapshot = null;
  var candidate = null, selfTests = null, evaluation = null, evaluationAt = null, evaluationModelVersion = null;
  var offline = { complete: false, shellAvailable: false, checkedAt: null, reason: 'Pas encore vérifié' };
  var training = false, exporting = false, toastTimer, modalResolve, previousFocus;
  var selectedDocumentIds = new Set(), documentImportController = null, documentImportGeneration = 0;
  var documentPreviewURLs = new Set();
  var DOCUMENT_LIMITS = { fileBytes: 8 * 1024 * 1024, totalBytes: 12 * 1024 * 1024, count: 6 };
  var welcomeHTML = document.getElementById('welcome').outerHTML;
  var initialTab = ['conversation', 'apprendre', 'memoire', 'atelier'].indexOf(location.hash.slice(1)) >= 0 ? location.hash.slice(1) : 'conversation';
  var labels = { conversation: 'Conversation', apprendre: 'Apprendre', memoire: 'Mémoire', atelier: 'Atelier' };
  var sourceLabels = { rule: 'Règle', model: 'Modèle appris', memory: 'Mémoire', document: 'Document', unknown: 'Non reconnu' };
  var runLabels = { evaluated: 'Évaluée, non adoptée', adopted: 'Adoptée', rejected: 'Écartée', rolled_back: 'Retour à la précédente' };

  function $(id) { return document.getElementById(id); }
  function el(tag, className, text) { var node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
  function icon(name) { var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); var use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#i-' + name); svg.appendChild(use); svg.setAttribute('aria-hidden', 'true'); return svg; }
  function now() { return new Date().toISOString(); }
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
  function uid(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9); }
  function category(id) { var found = Core.INTENTS.find(function (item) { return item.id === id; }); return found ? found.label : 'Non reconnu'; }
  function date(value, time) { try { return new Date(value).toLocaleString('fr-FR', time ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (_) { return String(value); } }
  function percent(value) { return Number.isFinite(value) ? Math.round(value * 100) + ' %' : 'Non mesuré'; }
  function note(type, author, detail) { Core.recordEvent(state, type, author, String(detail).slice(0, 2000)); }
  function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(function () { $('toast').hidden = true; }, 5200); }
  function warn(message) { $('storage-warning').textContent = message; $('storage-warning').hidden = !message; }
  function exampleKey(example) {
    return example.intent + '|' + example.text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  }
  function activeTrainingSnapshot() {
    if (!state.model) return null;
    for (var index = state.trainingRuns.length - 1; index >= 0; index -= 1) {
      var run = state.trainingRuns[index];
      if (run.modelVersion === state.model.version && Array.isArray(run.examplesSnapshot)) return run.examplesSnapshot;
    }
    return null;
  }
  function activeExampleCoverage() {
    var snapshot = activeTrainingSnapshot();
    if (!snapshot) return { known: !state.model, keys: new Set(), pending: state.model ? null : state.examples.length };
    var keys = new Set(snapshot.map(exampleKey));
    return { known: true, keys: keys, pending: state.examples.filter(function (example) { return !keys.has(exampleKey(example)); }).length };
  }
  function renderActiveModel() {
    var target = $('active-model-detail'); target.replaceChildren();
    var coverage = activeExampleCoverage(), summary;
    if (!state.model) {
      summary = 'Aucun modèle actif : POI utilise ses règles et sa mémoire.';
      target.appendChild(el('strong', '', 'Aucun modèle entraîné pour le moment.'));
      target.appendChild(el('p', '', 'Ajoutez vos formulations, calculez une version puis adoptez-la pour l’utiliser dans la conversation.'));
    } else {
      summary = 'Version active : ' + state.model.examplesUsed + ' exemples · ' + date(state.model.trainedAt, true) + '.';
      target.appendChild(el('strong', '', 'Version active dans la conversation'));
      target.appendChild(el('p', '', state.model.examplesUsed + ' exemples · ' + state.model.config.epochs + ' passages · entraînée le ' + date(state.model.trainedAt) + '.'));
      if (!coverage.known) target.appendChild(el('p', '', 'L’instantané des exemples de cette version n’est plus disponible. Leur présence dans le modèle ne peut pas être vérifiée ici.'));
      else if (coverage.pending) {
        var pending = coverage.pending + (coverage.pending > 1 ? ' exemples disponibles ne font' : ' exemple disponible ne fait') + ' pas encore partie de cette version.';
        target.appendChild(el('p', 'pending-examples', pending + ' Entraînez puis adoptez une nouvelle version.'));
        summary += ' ' + coverage.pending + (coverage.pending > 1 ? ' exemples en attente.' : ' exemple en attente.');
      } else target.appendChild(el('p', '', 'Toutes les formulations actuellement enregistrées figurent dans les données de cette version. Cela ne garantit pas qu’elle les reconnaisse toutes.'));
      var details = el('details', 'model-reference'); details.appendChild(el('summary', '', 'Référence du modèle')); details.appendChild(el('code', '', state.model.version)); target.appendChild(details);
    }
    $('conversation-model-status').textContent = summary;
  }

  function confirmAction(title, message, buttonText) {
    previousFocus = document.activeElement;
    $('modal-title').textContent = title;
    $('modal-message').textContent = message;
    $('modal-confirm').textContent = buttonText || 'Confirmer';
    $('modal-backdrop').hidden = false;
    $('modal-cancel').focus();
    return new Promise(function (resolve) { modalResolve = resolve; });
  }
  function closeModal(result) {
    $('modal-backdrop').hidden = true;
    var resolve = modalResolve; modalResolve = null;
    if (previousFocus && previousFocus.isConnected) previousFocus.focus();
    if (resolve) resolve(result);
  }

  function storageRequest(storeName, mode, operation) {
    return new Promise(function (resolve, reject) {
      var transaction = db.transaction(storeName, mode), request;
      try { request = operation(transaction.objectStore(storeName)); } catch (error) { reject(error); return; }
      transaction.oncomplete = function () { resolve(request.result); };
      transaction.onerror = function () { reject(transaction.error || new Error('Stockage inaccessible.')); };
      transaction.onabort = function () { reject(transaction.error || new Error('Enregistrement interrompu.')); };
    });
  }
  function openStorage() {
    return new Promise(function (resolve) {
      if (!window.indexedDB) { fallbackStorage(); resolve(); return; }
      var settled = false, request;
      var timeout = setTimeout(function () { if (!settled) { settled = true; fallbackStorage(); resolve(); } }, 4000);
      try { request = indexedDB.open('poi-atelier-local', 1); } catch (_) { clearTimeout(timeout); fallbackStorage(); resolve(); return; }
      request.onupgradeneeded = function () { if (!request.result.objectStoreNames.contains('state')) request.result.createObjectStore('state'); };
      request.onsuccess = function () {
        if (settled) { request.result.close(); return; }
        settled = true; clearTimeout(timeout); db = request.result; storageMode = 'indexedDB';
        db.onversionchange = function () { db.close(); db = null; storageMode = 'memory'; warn('Le stockage a changé dans un autre onglet. Exportez votre travail, puis rechargez cette page.'); renderStorage(); };
        resolve();
      };
      request.onerror = request.onblocked = function () { if (!settled) { settled = true; clearTimeout(timeout); fallbackStorage(); resolve(); } };
    });
  }
  function fallbackStorage() {
    try { localStorage.setItem('poi-storage-check', 'ok'); localStorage.removeItem('poi-storage-check'); storageMode = 'localStorage'; }
    catch (_) { storageMode = 'memory'; warn('Le stockage de ce navigateur est indisponible. Votre travail reste dans cette session : exportez-le avant de fermer.'); }
  }
  async function loadState() {
    var candidates = [], errors = [];
    function consider(raw, origin) {
      if (!raw) return;
      try { candidates.push({ state: Core.importState(typeof raw === 'string' ? raw : JSON.stringify(raw)), origin: origin }); }
      catch (error) { errors.push(error.message); }
    }
    if (storageMode === 'indexedDB') {
      try { consider(await storageRequest('state', 'readonly', function (store) { return store.get('current'); }), 'indexedDB'); }
      catch (error) { errors.push(error.message); }
    }
    try { consider(localStorage.getItem('poi-state-v1'), 'localStorage'); } catch (_) { /* A blocked fallback does not invalidate a readable primary state. */ }
    candidates.sort(function (a, b) { return Date.parse(b.state.meta.updatedAt) - Date.parse(a.state.meta.updatedAt); });
    if (candidates.length) {
      var chosen = candidates[0];
      if (chosen.origin === 'localStorage' && storageMode === 'indexedDB') {
        Core.recordEvent(chosen.state, 'storage_recovered', 'system', 'Reprise de la sauvegarde de secours la plus récente vers le stockage principal.');
      }
      return chosen.state;
    }
    if (errors.length) {
      writeBlocked = true; lastStorageError = errors.join(' ');
      warn('Une sauvegarde locale n’a pas pu être chargée. Elle est conservée sans modification. Vous pouvez restaurer un fichier JSON ou réinitialiser l’atelier. Détail : ' + lastStorageError);
    }
    return Core.createState();
  }
  function save() {
    state.meta.updatedAt = now();
    var snapshot;
    try { snapshot = Core.exportState(state); lastValidSnapshot = snapshot; }
    catch (error) {
      if (lastValidSnapshot) { state = Core.importState(lastValidSnapshot); candidate = null; renderAll(); }
      warn('La dernière modification a été annulée pour préserver une sauvegarde complète et restaurable. Exportez votre travail avant de réduire l’historique. ' + error.message);
      toast('Modification annulée : ' + error.message);
      return Promise.resolve(false);
    }
    var revision = ++saveRevision;
    $('save-label').textContent = storageMode === 'memory' ? 'Session temporaire · pensez à exporter' : 'Enregistrement…';
    saveQueue = saveQueue.then(async function () {
      if (writeBlocked) throw new Error('Écriture suspendue pour préserver une sauvegarde illisible.');
      if (storageMode === 'indexedDB') {
        await storageRequest('state', 'readwrite', function (store) { return store.put(snapshot, 'current'); });
        try { localStorage.removeItem('poi-state-v1'); } catch (_) { /* Primary write already committed. */ }
      }
      else if (storageMode === 'localStorage') localStorage.setItem('poi-state-v1', snapshot);
      else throw new Error('Stockage persistant indisponible dans ce navigateur.');
      lastSavedAt = now(); lastStorageError = null;
      if (revision === saveRevision) { $('save-label').textContent = 'Enregistré sur cet appareil · ' + date(lastSavedAt, true); renderStorage(); }
      return true;
    }).catch(function (error) {
      lastStorageError = error.message;
      $('save-label').textContent = 'Non enregistré · exportez votre travail';
      if (!writeBlocked) warn('Votre dernière modification n’a pas pu être enregistrée sur cet appareil. Exportez le dossier complet avant de fermer. ' + error.message);
      renderStorage(); return false;
    });
    return saveQueue;
  }
  function renderStorage() {
    var status = $('storage-status');
    status.textContent = lastStorageError || storageMode === 'memory' ? 'Session temporaire' : storageMode === 'indexedDB' ? 'Stockage local actif' : 'Stockage local limité';
    status.classList.toggle('ready', !lastStorageError && storageMode !== 'memory');
  }

  function navigate(tab, focus) {
    if (!labels[tab]) tab = 'conversation';
    document.querySelectorAll('.panel').forEach(function (panel) { panel.hidden = panel.id !== 'panel-' + tab; });
    document.querySelectorAll('.nav-item').forEach(function (button) {
      var active = button.dataset.tab === tab; button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    $('breadcrumb').textContent = labels[tab];
    if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
    if (focus) { $('main').focus({ preventScroll: true }); window.scrollTo({ top: 0 }); }
  }
  function renderStats() {
    var factCount = state.facts.length, exampleCount = state.examples.length;
    $('nav-facts').textContent = factCount;
    $('fact-count').textContent = factCount;
    $('example-count').textContent = exampleCount;
    $('model-state').textContent = state.model ? 'Entraîné' : 'Non entraîné';
    $('learning-example-count').textContent = exampleCount;
    $('learning-version').textContent = state.model ? state.model.examplesUsed : '—';
    $('memory-count').textContent = factCount + (factCount > 1 ? ' souvenirs' : ' souvenir');
    $('dataset-count').textContent = exampleCount + ' exemples';
    $('rollback-button').disabled = !state.previousModel || training;
    $('clear-chat').disabled = !state.messages.length;
    $('message-input').placeholder = 'Poser une question à ' + state.identity.name;
    var r = state.retention;
    $('retention-detail').textContent = 'L’atelier conserve au plus 2 000 messages, 5 000 événements, 100 entraînements, 100 souvenirs et 400 exemples. Des éléments anciens peuvent être retirés de l’historique ; exportez régulièrement. Déjà retirés par les limites : ' + r.messagesDropped + ' messages, ' + r.eventsDropped + ' événements, ' + r.trainingRunsDropped + ' entraînements. L’export contient tout ce qui est encore conservé.';
    renderActiveModel();
  }
  function renderChat(scroll) {
    var target = $('chat-messages'); target.replaceChildren();
    $('panel-conversation').classList.toggle('has-messages', state.messages.length > 0);
    if (!state.messages.length) {
      target.innerHTML = welcomeHTML;
      $('welcome-name').textContent = state.identity.name;
      var noteNode = target.querySelector('.welcome-note');
      if (state.model) noteNode.textContent = 'Votre modèle est entraîné. Les règles et vos souvenirs restent disponibles.';
    } else {
      // Keep the full trace in state and exports, limit DOM work on a small phone.
      var displayed = state.messages.slice(-100);
      if (state.messages.length > displayed.length) target.appendChild(el('p', 'help-text', 'Les 100 derniers messages sont affichés. L’export contient les ' + state.messages.length + ' messages conservés.'));
      displayed.forEach(function (message, index) {
        var container = el('article', 'chat-message ' + message.role), header = el('div', 'message-header');
        if (message.role === 'assistant') { var avatar = document.createElement('img'); avatar.src = './icon.svg'; avatar.alt = ''; avatar.className = 'message-avatar'; header.appendChild(avatar); }
        header.appendChild(el('strong', '', message.speakerName || (message.role === 'assistant' ? 'Assistant' : 'Utilisateur')));
        if (message.source) header.appendChild(el('span', 'source-badge', sourceLabels[message.source] || message.source));
        header.appendChild(el('span', '', date(message.createdAt, true)));
        container.appendChild(header); container.appendChild(el('div', 'message-bubble', message.text));
        if (message.role === 'assistant') {
          var detail = el('details', 'message-explanation'); detail.appendChild(el('summary', '', 'D’où vient cette réponse ?'));
          detail.appendChild(el('p', '', message.explanation || 'Réponse construite par le programme.'));
          if (message.score != null) detail.appendChild(el('p', '', 'Score de classement : ' + percent(message.score) + '. Il ne mesure pas la vérité de la réponse.'));
          var original = displayed[index - 1];
          if (original && original.role === 'user' && original.text.length <= 500) {
            var learn = el('button', 'text-button', 'Utiliser ma demande comme exemple'); learn.type = 'button';
            learn.addEventListener('click', function () { $('example-text').value = original.text; if (message.intent) $('example-intent').value = message.intent; navigate('apprendre', true); $('example-text').focus(); }); detail.appendChild(learn);
          }
          container.appendChild(detail);
        }
        target.appendChild(container);
      });
    }
    if (scroll) requestAnimationFrame(function () { target.scrollTop = target.scrollHeight; });
  }
  function renderExamples() {
    var target = $('example-list'); target.replaceChildren();
    var coverage = activeExampleCoverage();
    var sorted = state.examples.slice().sort(function (a, b) { return (a.origin === 'starter' ? 1 : 0) - (b.origin === 'starter' ? 1 : 0); });
    sorted.forEach(function (example) {
      var row = el('div', 'example-row'), main = el('div', 'row-main'), meta = el('div', 'row-meta');
      main.appendChild(el('p', '', example.text)); meta.appendChild(el('span', 'category', category(example.intent))); meta.appendChild(el('span', '', example.origin === 'starter' ? 'Exemple de départ' : 'Ajouté par vous'));
      if (example.origin === 'user') meta.appendChild(el('span', '', !state.model ? 'À entraîner' : !coverage.known ? 'Présence dans le modèle inconnue' : coverage.keys.has(exampleKey(example)) ? 'Dans les données du modèle actif' : 'Pas encore dans le modèle actif'));
      if (example.text.indexOf('=') >= 0) meta.appendChild(el('span', 'input-error', 'Exemple composé : remplacez-le par des formulations séparées.'));
      main.appendChild(meta); row.appendChild(main);
      var remove = el('button', 'icon-button'); remove.type = 'button'; remove.setAttribute('aria-label', 'Retirer l’exemple : ' + example.text); remove.appendChild(icon('trash'));
      remove.addEventListener('click', async function () {
        if (!await confirmAction('Retirer cet exemple ?', '« ' + example.text + ' » sera retiré des prochains entraînements. Le modèle actuel reste inchangé.', 'Retirer')) return;
        state.examples = state.examples.filter(function (item) { return item.id !== example.id; });
        note('example_removed', 'user', 'Exemple retiré : ' + example.text + ' ; catégorie : ' + example.intent + ' ; origine : ' + example.origin + '.');
        renderExamples(); renderStats(); renderCandidate(); save(); toast('Exemple retiré des prochains entraînements.');
      }); row.appendChild(remove); target.appendChild(row);
    });
    if (!sorted.length) target.appendChild(el('div', 'empty-small', 'Ajoutez des exemples dans chacune des six catégories.'));
  }
  function renderFacts() {
    var target = $('facts-list'); target.replaceChildren();
    if (!state.facts.length) {
      var empty = el('div', 'empty-state'); empty.appendChild(el('h3', '', 'La mémoire est encore vierge.')); empty.appendChild(el('p', '', 'Ajoutez un souvenir ici ou écrivez « Retiens : couleur préférée = bleu » dans la conversation.')); target.appendChild(empty); return;
    }
    state.facts.slice().reverse().forEach(function (fact) {
      var card = el('article', 'card fact-card'), heading = el('div', 'fact-heading'); heading.appendChild(el('h3', '', fact.key));
      var remove = el('button', 'icon-button'); remove.appendChild(icon('trash')); remove.setAttribute('aria-label', 'Supprimer le souvenir ' + fact.key);
      remove.addEventListener('click', async function () {
        if (!await confirmAction('Supprimer ce souvenir ?', '« ' + fact.key + ' = ' + fact.value + ' » sera retiré de la mémoire active. Sa trace peut rester dans la conversation, le journal et les exports précédents.', 'Supprimer')) return;
        state.facts = state.facts.filter(function (item) { return item.id !== fact.id; }); note('fact_deleted', 'user', 'Fait retiré de la mémoire active : ' + fact.key + ' = ' + fact.value + '.'); renderFacts(); renderStats(); save(); toast('Souvenir retiré de la mémoire active.');
      }); heading.appendChild(remove); card.appendChild(heading); card.appendChild(el('p', 'fact-value', fact.value));
      var footer = el('div', 'fact-footer'); footer.appendChild(el('span', '', 'Déclaré par vous')); footer.appendChild(el('span', '', date(fact.updatedAt))); card.appendChild(footer); target.appendChild(card);
    });
  }
  function documentList() { return Array.isArray(state.documents) ? state.documents : []; }
  function fileSize(bytes) { return bytes >= 1024 * 1024 ? (bytes / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Mio' : Math.max(1, Math.ceil(bytes / 1024)).toLocaleString('fr-FR') + ' Kio'; }
  function documentFeedback(message, error) {
    $('document-feedback').textContent = message || ''; $('document-feedback').hidden = !message;
    $('document-feedback').classList.toggle('has-error', Boolean(error));
  }
  function releaseDocumentPreviews() {
    documentPreviewURLs.forEach(function (url) { URL.revokeObjectURL(url); }); documentPreviewURLs.clear();
  }
  function selectedDocuments() {
    return documentList().filter(function (document) { return selectedDocumentIds.has(document.id); }).map(function (document) { return document.id; });
  }
  function renderDocumentSelection() {
    var count = selectedDocuments().length;
    $('document-selection-summary').textContent = count ? count + (count > 1 ? ' sélectionnés' : ' sélectionné') : 'Aucun sélectionné';
  }
  function documentPreview(document) {
    var details = el('details', 'document-preview'), body = el('div', 'document-preview-body'), imageURL = null;
    details.appendChild(el('summary', '', 'Aperçu et texte extrait')); details.appendChild(body);
    details.addEventListener('toggle', function () {
      if (!details.open) {
        if (imageURL) { URL.revokeObjectURL(imageURL); documentPreviewURLs.delete(imageURL); imageURL = null; }
        body.replaceChildren(); return;
      }
      body.replaceChildren();
      if (document.kind === 'image' && Docs && typeof Docs.documentBlob === 'function') {
        try {
          imageURL = URL.createObjectURL(Docs.documentBlob(document)); documentPreviewURLs.add(imageURL);
          var image = el('img', 'document-image'); image.src = imageURL; image.alt = 'Aperçu de ' + document.name; image.loading = 'lazy'; image.decoding = 'async'; body.appendChild(image);
        } catch (error) { body.appendChild(el('p', 'help-text', 'Aperçu de l’image indisponible : ' + error.message)); }
      }
      var extraction = document.extraction, pages = document.pages, readablePages = pages.filter(function (page) { return page.text.trim(); }).length;
      var unit = document.kind === 'pdf' ? 'page' : document.kind === 'image' ? 'image' : 'bloc';
      var examined = unit + (extraction.totalPages > 1 ? 's' : '') + ' examiné' + (unit === 'bloc' ? '' : 'e') + (extraction.totalPages > 1 ? 's' : '');
      body.appendChild(el('p', 'help-text', 'Extraction : ' + extraction.processedPages + ' / ' + extraction.totalPages + ' ' + examined + ' · ' + readablePages + ' ' + unit + (readablePages > 1 ? 's' : '') + ' avec du texte extrait. ' + (extraction.truncated ? 'Lecture partielle : le document n’a pas été lu intégralement.' : 'Le texte extrait peut comporter des erreurs.')));
      if (extraction.warnings && extraction.warnings.length) {
        var warnings = el('ul', 'document-warnings'); extraction.warnings.forEach(function (warning) { warnings.appendChild(el('li', '', warning)); }); body.appendChild(warnings);
      }
      if (!pages.length || !pages.some(function (page) { return page.text.trim(); })) { body.appendChild(el('p', 'help-text', 'Aucun texte exploitable n’a été extrait. Cette pièce jointe ne peut pas fournir de passage à la recherche.')); return; }
      var select = el('select', 'document-page-choice'); select.setAttribute('aria-label', document.kind === 'pdf' ? 'Page du PDF à lire' : 'Bloc de texte à lire');
      pages.forEach(function (page, index) { var option = el('option', '', (document.kind === 'pdf' ? 'Page ' : 'Bloc ') + page.number + (page.text.trim() ? '' : ' · sans texte')); option.value = String(index); select.appendChild(option); });
      if (pages.length > 1) body.appendChild(select);
      var pageLabel = el('p', 'help-text'), extracted = el('pre', 'document-extracted-text'), expand = el('button', 'text-button', 'Afficher tout le texte de ce bloc'); expand.type = 'button';
      function showPage(full) {
        var page = pages[Number(select.value) || 0], limited = !full && page.text.length > 12000;
        pageLabel.textContent = (document.kind === 'pdf' ? 'Page ' : 'Bloc ') + page.number + ' · ' + page.text.length.toLocaleString('fr-FR') + ' caractères' + (limited ? ' · aperçu limité aux 12 000 premiers.' : '.');
        extracted.textContent = page.text ? (limited ? page.text.slice(0, 12000) : page.text) : 'Aucun texte extrait pour cette page.'; expand.hidden = !limited;
      }
      select.addEventListener('change', function () { showPage(false); }); expand.addEventListener('click', function () { showPage(true); });
      body.appendChild(pageLabel); body.appendChild(extracted); body.appendChild(expand); showPage(false);
    });
    return details;
  }
  function renderDocuments() {
    releaseDocumentPreviews();
    var documents = documentList(), available = new Set(documents.map(function (document) { return document.id; }));
    selectedDocumentIds = new Set(Array.from(selectedDocumentIds).filter(function (id) { return available.has(id); }));
    var target = $('document-list'); target.replaceChildren(); $('documents-panel').hidden = !documents.length;
    $('document-count').textContent = documents.length + (documents.length > 1 ? ' documents sur cet appareil' : ' document sur cet appareil');
    documents.forEach(function (document) {
      var row = el('article', 'document-item'), header = el('div', 'document-item-heading'), label = el('label', 'document-select');
      var checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.checked = selectedDocumentIds.has(document.id); checkbox.setAttribute('aria-label', 'Utiliser ' + document.name + ' pour la recherche');
      checkbox.addEventListener('change', function () {
        if (this.checked) selectedDocumentIds.add(document.id); else selectedDocumentIds.delete(document.id);
        renderDocumentSelection(); note('document_selection', 'user', 'Documents sélectionnés pour les prochaines recherches : ' + selectedDocuments().join(', ')); save();
      });
      var name = el('span', 'document-name', document.name); label.appendChild(checkbox); label.appendChild(name); header.appendChild(label);
      var remove = el('button', 'icon-button'); remove.type = 'button'; remove.setAttribute('aria-label', 'Retirer le document ' + document.name); remove.appendChild(icon('trash'));
      remove.addEventListener('click', async function () {
        if (!await confirmAction('Retirer ce document ?', '« ' + document.name + ' » et son texte extrait seront retirés de cet atelier. Des passages peuvent rester dans la conversation et vos exports précédents. Le fichier d’origine sur votre appareil ne sera pas modifié.', 'Retirer')) return;
        try {
          Core.removeDocument(state, document.id); selectedDocumentIds.delete(document.id); renderDocuments(); var saved = await save();
          if (documentList().some(function (item) { return item.id === document.id; })) { documentFeedback('Le retrait a été annulé pour conserver une sauvegarde restaurable.', true); return; }
          toast(saved ? 'Document retiré de cet atelier.' : 'Document retiré dans cette session. Exportez votre travail avant de fermer.');
        }
        catch (error) { documentFeedback(error.message, true); }
      }); header.appendChild(remove); row.appendChild(header);
      var characters = document.pages.reduce(function (total, page) { return total + page.text.length; }, 0);
      row.appendChild(el('p', 'document-meta', fileSize(document.size) + ' · ' + characters.toLocaleString('fr-FR') + ' caractères extraits' + (document.extraction.truncated ? ' · lecture partielle' : '')));
      if (document.extraction.warnings && document.extraction.warnings.length) row.appendChild(el('p', 'document-warning-summary', document.extraction.warnings.length + (document.extraction.warnings.length > 1 ? ' remarques d’extraction à consulter dans l’aperçu.' : ' remarque d’extraction à consulter dans l’aperçu.')));
      row.appendChild(documentPreview(document)); target.appendChild(row);
    });
    renderDocumentSelection();
    $('attach-button').disabled = Boolean(documentImportController) || !Docs || typeof Docs.importFile !== 'function';
    $('attach-button').title = !Docs ? 'Le module de lecture des documents est indisponible. Rechargez avec une connexion.' : 'Joindre un document ou une photo';
  }
  function stopDocumentImport(silent) {
    if (documentImportController) documentImportController.abort();
    if (silent) {
      documentImportGeneration += 1; documentImportController = null;
      $('document-import-status').hidden = true; $('attach-button').disabled = !Docs;
    } else {
      $('cancel-document-import').disabled = true; $('document-progress-text').textContent = 'Annulation de l’importation…';
    }
  }
  async function importDocuments(files) {
    if (documentImportController || !files || !files.length) return;
    if (!Docs || typeof Docs.importFile !== 'function') { documentFeedback('Le module de lecture est indisponible. Rechargez POI avec une connexion, puis réessayez.', true); return; }
    var selectedFiles = Array.from(files); $('document-input').value = '';
    if (documentList().length + selectedFiles.length > DOCUMENT_LIMITS.count) { documentFeedback('Vous pouvez conserver 6 documents au maximum. Retirez un document ou choisissez moins de fichiers avant de recommencer.', true); return; }
    var controller = new AbortController(), generation = ++documentImportGeneration, imported = [], problems = [];
    documentImportController = controller; $('document-import-status').hidden = false; $('cancel-document-import').disabled = false; $('attach-button').disabled = true; documentFeedback('');
    try {
      for (var index = 0; index < selectedFiles.length; index += 1) {
        if (controller.signal.aborted || generation !== documentImportGeneration) break;
        var file = selectedFiles[index], prefix = (index + 1) + ' / ' + selectedFiles.length + ' · ' + file.name + ' · ';
        $('document-progress-text').textContent = prefix + 'Préparation…'; $('document-progress').removeAttribute('value');
        try {
          if (file.size > DOCUMENT_LIMITS.fileBytes) throw new Error('Ce fichier dépasse la limite de 8 Mio.');
          if (documentList().reduce(function (total, document) { return total + document.size; }, 0) + file.size > DOCUMENT_LIMITS.totalBytes) throw new Error('Les fichiers joints dépasseraient la limite totale de 12 Mio.');
          var extracted = await Docs.importFile(file, { signal: controller.signal, onProgress: function (progress) {
            if (generation !== documentImportGeneration || controller.signal.aborted) return;
            $('document-progress-text').textContent = prefix + (progress.message || 'Lecture en cours…');
            if (Number.isFinite(progress.progress)) $('document-progress').value = Math.max(0, Math.min(1, progress.progress)); else $('document-progress').removeAttribute('value');
          } });
          if (controller.signal.aborted || generation !== documentImportGeneration) break;
          var added = Core.addDocument(state, extracted); selectedDocumentIds.add(added.id);
          (added.extraction.warnings || []).forEach(function (warning) { problems.push(added.name + ' : ' + warning); });
          renderDocuments(); $('documents-panel').open = true; await save();
          if (documentList().some(function (item) { return item.id === added.id; })) imported.push(added.name);
          else problems.push(added.name + ' : l’ajout a été annulé pour conserver un état restaurable.');
        } catch (error) {
          if (controller.signal.aborted || error.name === 'AbortError') break;
          problems.push(file.name + ' : ' + error.message);
        }
      }
    } finally {
      if (generation === documentImportGeneration) {
        var cancelled = controller.signal.aborted; documentImportController = null; $('document-import-status').hidden = true; $('cancel-document-import').disabled = false; renderDocuments();
        var message = imported.length ? imported.length + (imported.length > 1 ? ' documents ajoutés et sélectionnés.' : ' document ajouté et sélectionné.') : 'Aucun document ajouté.';
        if (cancelled) message = 'Importation arrêtée. ' + message;
        if (problems.length) message += '\n' + problems.join('\n');
        if (lastStorageError) message += '\nEnregistrement local indisponible : exportez votre travail avant de fermer.';
        documentFeedback(message, Boolean(problems.length || lastStorageError));
      }
    }
  }
  function renderIdentity() { $('agent-name').value = state.identity.name; $('agent-role').value = state.identity.role; $('user-name').value = state.identity.userName; }
  function renderHistory() {
    var target = $('training-history'); target.replaceChildren(); target.classList.toggle('empty-small', !state.trainingRuns.length);
    if (!state.trainingRuns.length) { target.textContent = 'Aucun entraînement pour le moment.'; return; }
    state.trainingRuns.slice().reverse().forEach(function (run) {
      var row = el('div', 'history-item'); row.appendChild(el('strong', '', (state.model && run.modelVersion === state.model.version ? 'Active · ' : '') + (runLabels[run.status] || run.status) + ' · ' + date(run.createdAt)));
      if (run.metrics) row.appendChild(el('p', '', (run.metrics.examples == null ? 'Non mesuré' : run.metrics.examples) + ' exemples · ' + (run.metrics.epochs == null ? 'Non mesuré' : run.metrics.epochs) + ' passages · erreur ' + (Number.isFinite(run.metrics.lossBefore) ? run.metrics.lossBefore.toFixed(3) : 'non mesurée') + ' → ' + (Number.isFinite(run.metrics.lossAfter) ? run.metrics.lossAfter.toFixed(3) : 'non mesurée')));
      if (run.evaluationAfter) row.appendChild(el('p', '', 'Jeu de contrôle : ' + run.evaluationAfter.correct + ' / ' + run.evaluationAfter.total + ' demandes reconnues correctement.'));
      row.appendChild(el('small', '', run.reason || 'Les paramètres et le contexte de cet essai sont conservés dans l’export.')); target.appendChild(row);
    });
  }
  function evaluationView(result) {
    var wrapper = el('div'); wrapper.appendChild(el('div', 'test-summary', result.correct + ' / ' + result.total + ' formulations reconnues correctement · ' + percent(result.accuracy)));
    var table = el('table', 'evaluation-table'), head = el('thead'), header = el('tr');
    ['Formulation', 'Attendu', 'Obtenu'].forEach(function (text) { header.appendChild(el('th', '', text)); }); head.appendChild(header); table.appendChild(head);
    var body = el('tbody'); result.results.forEach(function (item) { var row = el('tr'); row.appendChild(el('td', '', item.text)); row.appendChild(el('td', '', category(item.expected))); row.appendChild(el('td', item.correct ? 'test-result' : 'test-result fail', item.predicted ? category(item.predicted) : 'Refus / inconnu')); body.appendChild(row); }); table.appendChild(body); wrapper.appendChild(table);
    wrapper.appendChild(el('p', 'help-text', result.note || 'Ce petit jeu de contrôle ne mesure pas une compréhension générale du langage.')); return wrapper;
  }
  function personalComparison() {
    var examples = state.examples.filter(function (example) { return example.origin === 'user'; });
    return { before: Core.evaluateExamples(state.model, examples), after: Core.evaluateExamples(candidate.model, examples) };
  }
  function personalComparisonView(comparison) {
    var wrapper = el('section', 'personal-comparison'); wrapper.appendChild(el('h3', '', 'Vos formulations'));
    if (!comparison.after.total) { wrapper.appendChild(el('p', 'help-text', 'Ajoutez vos propres exemples pour comparer leur reconnaissance par la version active et cet essai.')); return wrapper; }
    wrapper.appendChild(el('p', '', 'Version active : ' + comparison.before.correct + ' / ' + comparison.before.total + ' · Nouvelle version : ' + comparison.after.correct + ' / ' + comparison.after.total + '.'));
    wrapper.appendChild(el('p', 'help-text', 'Ces formulations peuvent avoir servi à l’entraînement. Ce contrôle montre si elles sont reconnues ; il ne mesure pas la généralisation.'));
    var details = el('details', 'personal-results'); details.appendChild(el('summary', '', 'Comparer les ' + comparison.after.total + ' formulations'));
    comparison.after.results.forEach(function (result, index) {
      var previous = comparison.before.results[index], row = el('div', 'personal-result'), values = el('div', 'personal-result-values');
      row.appendChild(el('strong', '', result.text)); row.appendChild(el('span', 'help-text', 'Attendu : ' + category(result.expected)));
      [[previous, 'Version active'], [result, 'Nouvelle version']].forEach(function (pair) {
        var cell = el('div'); cell.appendChild(el('small', '', pair[1])); cell.appendChild(el('span', pair[0].correct ? 'test-result' : 'test-result fail', pair[0].predicted ? category(pair[0].predicted) : 'Non reconnu'));
        if (pair[0].score != null) cell.appendChild(el('small', '', 'Score : ' + percent(pair[0].score))); values.appendChild(cell);
      }); row.appendChild(values); details.appendChild(row);
    }); wrapper.appendChild(details); return wrapper;
  }
  function lostControls(before, after) {
    return before.results.filter(function (previous) {
      if (!previous.correct) return false;
      var current = after.results.find(function (result) { return result.text === previous.text && result.expected === previous.expected; });
      return current && !current.correct;
    });
  }
  function renderCandidate() {
    $('candidate-card').hidden = !candidate;
    if (!candidate) return;
    var target = $('candidate-results'); target.replaceChildren(); var metrics = el('div', 'candidate-metrics');
    [[candidate.before, 'Version actuelle'], [candidate.after, 'Nouvelle version']].forEach(function (pair) { var box = el('div'); box.appendChild(el('small', '', pair[1])); box.appendChild(el('strong', '', pair[0].correct + ' / ' + pair[0].total)); box.appendChild(el('small', '', 'sur le jeu de contrôle')); metrics.appendChild(box); }); target.appendChild(metrics);
    target.appendChild(el('p', 'help-text', 'Erreur sur les exemples d’apprentissage : ' + candidate.metrics.lossBefore.toFixed(3) + ' → ' + candidate.metrics.lossAfter.toFixed(3) + '. Calcul effectué en ' + Math.round(candidate.metrics.durationMs) + ' ms dans cette session.'));
    target.appendChild(personalComparisonView(personalComparison()));
    var regression = candidate.after.correct < candidate.before.correct;
    if (regression) {
      target.appendChild(el('p', 'notice notice-warning', 'Cette version réussit moins de contrôles. Examinez les changements avant de choisir de l’adopter. La version actuelle sera conservée pour permettre un retour.'));
      var lost = lostControls(candidate.before, candidate.after), list = el('ul', 'lost-controls');
      lost.forEach(function (result) { list.appendChild(el('li', '', 'N’est plus reconnue correctement : « ' + result.text + ' »')); }); target.appendChild(list);
    }
    else target.appendChild(el('p', 'notice notice-success', 'Le contrôle ne détecte pas de baisse du nombre de bonnes réponses. Vous pouvez examiner puis adopter cette version.'));
    var details = el('details', 'message-explanation'); details.appendChild(el('summary', '', 'Voir toutes les formulations de contrôle')); details.appendChild(evaluationView(candidate.after)); target.appendChild(details);
    $('adopt-button').disabled = false;
    $('adopt-button').textContent = regression ? 'Examiner et adopter' : 'Adopter cette version';
  }
  function renderAll() { renderStats(); renderChat(true); renderExamples(); renderFacts(); renderDocuments(); renderIdentity(); renderHistory(); renderCandidate(); renderStorage(); }

  async function sendMessage(text) {
    if (training || !text.trim()) return;
    try {
      Core.reply(state, text.trim(), { documentIds: selectedDocuments() }); $('message-input').value = ''; $('message-count').textContent = '0'; $('message-input').style.height = ''; $('send-button').disabled = true;
      renderChat(true); renderStats(); renderFacts(); save();
    } catch (error) { toast(error.message); }
  }
  async function trainModel() {
    if (training) return;
    if (candidate && !await confirmAction('Remplacer l’essai en attente ?', 'L’essai actuel sera marqué comme écarté. Il restera documenté dans l’export.', 'Nouvel essai')) return;
    if (candidate) discardCandidate('Écartée pour préparer un autre essai.');
    training = true; $('train-button').disabled = true; $('train-button').textContent = 'Apprentissage en cours…'; $('training-status').textContent = 'Le calcul se fait sur cet appareil. Gardez cette page ouverte.';
    try {
      await new Promise(function (resolve) { setTimeout(resolve, 30); });
      var samples = clone(state.examples), before = Core.evaluate(state.model);
      var result = Core.train(samples, { epochs: Number($('epochs').value) });
      var after = Core.evaluate(result.model), runId = uid('run');
      Core.appendTrainingRun(state, { id: runId, createdAt: now(), status: 'evaluated', modelVersion: result.model.version, metrics: result.metrics, evaluationBefore: before, evaluationAfter: after, examplesSnapshot: samples, parametersSnapshot: result.model, config: result.model.config, reason: 'Version calculée et évaluée ; aucune adoption effectuée à ce stade.' });
      candidate = { model: result.model, metrics: result.metrics, before: before, after: after, runId: runId, evaluatedAt: now() };
      note('training_evaluated', 'user', 'Nouvelle version ' + result.model.version + ' entraînée depuis des paramètres nuls sur ' + samples.length + ' exemples ; ' + result.metrics.epochs + ' passages ; jeu de contrôle : ' + after.correct + '/' + after.total + '. En attente de décision.');
      var personal = personalComparison();
      note('personal_examples_evaluated', 'system', 'Formulations personnelles (elles peuvent servir à l’entraînement) : version active ' + (state.model ? state.model.version : 'aucune') + ' = ' + personal.before.correct + '/' + personal.before.total + ' ; candidat ' + result.model.version + ' = ' + personal.after.correct + '/' + personal.after.total + '.');
      renderCandidate(); renderHistory(); var saved = await save();
      if (!candidate || candidate.runId !== runId) { $('training-status').textContent = 'Cet essai n’a pas été conservé. Consultez le message de sauvegarde avant de recommencer.'; return; }
      $('candidate-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('training-status').textContent = saved ? 'Essai terminé. Examinez les résultats avant d’adopter la version.' : 'Essai disponible dans cette session. L’enregistrement local a échoué : exportez avant de fermer.';
    } catch (error) { $('training-status').textContent = error.message; toast(error.message); }
    finally { training = false; $('train-button').disabled = false; $('train-button').replaceChildren(icon('learn'), document.createTextNode('Entraîner une nouvelle version')); }
  }
  function discardCandidate(reason) {
    if (!candidate) return;
    var run = state.trainingRuns.find(function (item) { return item.id === candidate.runId; }); if (run) { run.status = 'rejected'; run.reason = reason || 'Version écartée par l’utilisateur après examen.'; }
    note('model_rejected', 'user', 'Version ' + candidate.model.version + ' écartée. ' + (reason || '')); candidate = null; renderCandidate(); renderHistory(); save();
  }
  function download(content, mime, filename) {
    var blob = new Blob([content], { type: mime }), url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename; link.style.display = 'none'; document.body.appendChild(link); link.click(); link.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  function exportContext() { return { createdAt: now(), appVersion: APP_VERSION, coreVersion: Core.VERSION, display: { preference: $('theme-choice').value, effective: document.documentElement.dataset.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') }, selfTests: selfTests, evaluation: evaluation, evaluationAt: evaluationAt, evaluationModelVersion: evaluationModelVersion, offline: clone(offline), storage: { mode: storageMode, lastSavedAt: lastSavedAt, lastError: lastStorageError, writeBlocked: writeBlocked }, userAgent: navigator.userAgent, language: navigator.language, platform: navigator.platform, limits: Core.LIMITS }; }
  function exportComplete() {
    if (exporting || training) return;
    exporting = true;
    try {
      note('export_requested', 'user', 'Demande d’un dossier complet : état JSON, rapport, données tabulaires, paramètres des modèles et contexte disponible.');
      var result = Exporter.produce(state, exportContext());
      download(result.bytes, 'application/zip', result.filename); save(); toast('Dossier complet préparé : ' + result.files.length + ' fichiers. Retrouvez-le dans vos téléchargements.');
    } catch (error) { toast('Export impossible : ' + error.message); }
    finally { exporting = false; }
  }
  async function restoreFile(file) {
    if (!file) return;
    if (file.size > Core.LIMITS.importBytes) { toast('La sauvegarde doit faire moins de 25 Mo.'); return; }
    try {
      var content = await file.text(), restored = Core.importState(content);
      var message = restored.messages.length + ' messages, ' + restored.facts.length + ' souvenirs, ' + restored.examples.length + ' exemples et ' + (restored.documents || []).length + ' documents seront restaurés.\n\nL’état actuel sera remplacé. Exportez-le d’abord si vous souhaitez le conserver.';
      if (!await confirmAction('Restaurer cette sauvegarde ?', message, 'Remplacer et restaurer')) return;
      stopDocumentImport(true); selectedDocumentIds.clear(); documentFeedback('');
      state = restored; candidate = null; evaluation = null; evaluationAt = null; evaluationModelVersion = null; selfTests = null; writeBlocked = false; warn('');
      note('backup_restored', 'user', 'Sauvegarde validée puis restaurée depuis le fichier ' + file.name + '.');
      renderAll(); $('evaluation-result').textContent = 'Aucune évaluation lancée dans cette session.'; $('selftest-results').textContent = 'Aucun contrôle exécuté dans cette session.';
      await save(); toast(lastStorageError ? 'Sauvegarde chargée dans cette session. Vérifiez le message de stockage.' : 'Sauvegarde restaurée et enregistrée sur cet appareil.');
    } catch (error) { toast('Fichier refusé : ' + error.message); }
    finally { $('import-input').value = ''; }
  }

  function showOfflineStatus(status) {
    offline = Object.assign({}, status, { checkedAt: now() });
    $('offline-status').textContent = offline.complete ? 'Prêt hors ligne' : 'À préparer'; $('offline-status').classList.toggle('ready', Boolean(offline.complete));
    $('offline-detail').textContent = offline.complete ? 'Les fichiers nécessaires sont enregistrés. Ouvrez aussi l’icône d’accueil une première fois en ligne, puis essayez le mode avion.' : (offline.reason || 'Les fichiers nécessaires ne sont pas tous disponibles. Gardez la connexion active, puis relancez la vérification.');
  }
  function askWorker(worker) {
    return new Promise(function (resolve, reject) {
      var channel = new MessageChannel(), timer = setTimeout(function () { channel.port1.close(); reject(new Error('Le mode hors ligne n’a pas répondu.')); }, 4000);
      channel.port1.onmessage = function (event) { clearTimeout(timer); channel.port1.close(); if (!event.data || event.data.type !== 'OFFLINE_STATUS') reject(new Error('Réponse de vérification non reconnue.')); else resolve(event.data); };
      worker.postMessage({ type: 'GET_OFFLINE_STATUS' }, [channel.port2]);
    });
  }
  async function prepareOffline() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) { showOfflineStatus({ complete: false, shellAvailable: false, reason: 'Le mode hors ligne demande une adresse HTTPS ouverte dans Safari.' }); return; }
    $('offline-status').textContent = 'Préparation…';
    try {
      var registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      var worker = registration.active;
      if (!worker) {
        worker = await new Promise(function (resolve, reject) {
          var pending = registration.installing || registration.waiting;
          if (!pending) { reject(new Error('Installation hors ligne encore en attente.')); return; }
          var timeout = setTimeout(function () { reject(new Error('Préparation encore en cours. Réessayez dans quelques instants.')); }, 12000);
          function changed() { if (pending.state === 'activated') { clearTimeout(timeout); resolve(registration.active || pending); } else if (pending.state === 'redundant') { clearTimeout(timeout); reject(new Error('Installation incomplète. Rechargez la page avec une connexion active.')); } }
          pending.addEventListener('statechange', changed); changed();
        });
      }
      var status = await askWorker(worker); showOfflineStatus(status);
    } catch (error) { showOfflineStatus({ complete: false, shellAvailable: false, reason: error.message }); }
  }

  function bind() {
    var savedTheme = 'system'; try { savedTheme = localStorage.getItem('poi-theme') || 'system'; } catch (_) {}
    $('theme-choice').value = ['light', 'dark'].indexOf(savedTheme) >= 0 ? savedTheme : 'system';
    $('theme-choice').addEventListener('change', function () {
      if (this.value === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = this.value;
      try { localStorage.setItem('poi-theme', this.value); } catch (_) {}
      note('appearance_changed', 'user', 'Apparence choisie : ' + this.value + '.'); save();
    });
    document.querySelectorAll('[data-tab]').forEach(function (button) { button.addEventListener('click', function () { navigate(button.dataset.tab, true); }); });
    document.querySelectorAll('[data-action="export"]').forEach(function (button) { button.addEventListener('click', exportComplete); });
    document.querySelectorAll('[data-prompt]').forEach(function (button) { button.addEventListener('click', function () { sendMessage(button.dataset.prompt); }); });
    window.addEventListener('hashchange', function () { navigate(location.hash.slice(1), false); });
    $('chat-form').addEventListener('submit', function (event) { event.preventDefault(); sendMessage($('message-input').value); });
    $('attach-button').addEventListener('click', function () {
      if (documentList().length >= DOCUMENT_LIMITS.count) { $('documents-panel').open = true; documentFeedback('Les 6 emplacements sont utilisés. Retirez un document pour en joindre un autre.', true); return; }
      documentFeedback('Les modules PDF, Word et OCR se téléchargent à la première utilisation. Les textes déjà extraits restent accessibles hors ligne. Aucun contenu de vos fichiers n’est envoyé.');
      $('document-input').click();
    });
    $('document-input').addEventListener('change', function () { importDocuments(this.files).catch(function (error) { documentFeedback('Importation impossible : ' + error.message, true); }); });
    $('cancel-document-import').addEventListener('click', function () { stopDocumentImport(false); });
    $('message-input').addEventListener('input', function () { var chat = $('chat-messages'), wasAtEnd = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 24; $('message-count').textContent = this.value.length.toLocaleString('fr-FR'); this.style.height = 'auto'; this.style.height = Math.min(200, Math.max(28, this.scrollHeight)) + 'px'; $('send-button').disabled = !this.value.trim(); if (wasAtEnd) requestAnimationFrame(function () { chat.scrollTop = chat.scrollHeight; }); });
    $('message-input').addEventListener('keydown', function (event) { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && window.matchMedia('(min-width:701px)').matches) { event.preventDefault(); sendMessage(this.value); } });
    $('clear-chat').addEventListener('click', async function () {
      if (!await confirmAction('Effacer la conversation ?', 'Les messages seront retirés de l’état actif. Vos souvenirs et votre modèle seront conservés. Des traces de ces échanges peuvent rester dans le journal et vos anciens exports.', 'Effacer les messages')) return;
      var count = state.messages.length; state.messages = []; note('conversation_cleared', 'user', 'Suppression volontaire de ' + count + ' messages de la conversation active.'); renderChat(false); renderStats(); save();
    });
    $('example-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var text = $('example-text').value.trim(), feedback = $('example-feedback');
      try {
        if (text.indexOf('=') >= 0) throw new Error('Séparez les formulations : écrivez « Yo », « Hello » ou « Salut », une par ligne, puis choisissez « Salutation ». « Yo=Bonjour » n’apprend pas « Yo » séparément. Aucun exemple ajouté.');
        var result = Core.addExamples(state, text, $('example-intent').value);
        var message = result.added + (result.added > 1 ? ' exemples ajoutés.' : ' exemple ajouté.');
        if (result.skipped) message += ' ' + result.skipped + (result.skipped > 1 ? ' doublons déjà présents ignorés.' : ' doublon déjà présent ignoré.');
        message += ' Entraînez puis adoptez une version pour utiliser vos nouveaux exemples.';
        renderExamples(); renderStats(); renderCandidate(); var saved = await save();
        if (result.examples && !result.examples.every(function (example) { return state.examples.some(function (item) { return item.id === example.id; }); })) throw new Error('L’ajout a été annulé pour conserver un état restaurable. Votre saisie est conservée.');
        feedback.textContent = message; feedback.classList.remove('input-error');
        if (saved) $('example-text').value = '';
        else feedback.textContent += ' Vérifiez l’état de sauvegarde avant de quitter cette page.';
        toast(message);
      } catch (error) { feedback.textContent = error.message; feedback.classList.add('input-error'); toast(error.message); }
    });
    $('memory-form').addEventListener('submit', function (event) {
      event.preventDefault(); var key = $('fact-key').value.trim(), value = $('fact-value').value.trim();
      if (!key || !value || /[=\r\n]/.test(key) || /[\r\n]/.test(value)) { toast('Utilisez un sujet et une valeur sur une seule ligne, sans signe = dans le sujet.'); return; }
      try { var response = Core.handleMessage(state, 'Retiens : ' + key + ' = ' + value); if (response.source !== 'memory') { toast(response.text); renderChat(false); save(); return; } $('memory-form').reset(); renderFacts(); renderChat(false); renderStats(); save(); toast('Souvenir enregistré. L’opération figure aussi dans la conversation.'); }
      catch (error) { toast(error.message); }
    });
    $('identity-form').addEventListener('submit', function (event) {
      event.preventDefault(); var name = $('agent-name').value.trim(), role = $('agent-role').value.trim(), userName = $('user-name').value.trim(); if (!name || !role) return;
      var before = clone(state.identity); state.identity = { name: name, role: role, userName: userName }; note('identity_changed', 'user', 'Identité précédente : ' + JSON.stringify(before) + '. Nouvelle identité : ' + JSON.stringify(state.identity) + '.'); renderChat(false); renderStats(); save(); toast('Identité enregistrée. Les capacités techniques restent les mêmes.');
    });
    $('train-button').addEventListener('click', trainModel);
    $('adopt-button').addEventListener('click', async function () {
      if (!candidate) return;
      candidate.before = Core.evaluate(state.model);
      var adopting = candidate, regression = adopting.after.correct < adopting.before.correct, personal = personalComparison();
      if (regression) {
        renderCandidate(); var lost = lostControls(adopting.before, adopting.after);
        var message = 'Cette version réussit ' + adopting.after.correct + ' / ' + adopting.after.total + ' contrôles, contre ' + adopting.before.correct + ' / ' + adopting.before.total + ' actuellement.';
        if (personal.after.total) message += '\n\nVos formulations : ' + personal.after.correct + ' / ' + personal.after.total + ' reconnues, contre ' + personal.before.correct + ' / ' + personal.before.total + ' actuellement.';
        if (lost.length) message += '\n\nNe sont plus reconnues correctement :\n' + lost.map(function (result) { return '• ' + result.text; }).join('\n');
        message += '\n\nLa version actuelle sera conservée. Vous pourrez y revenir avec « Revenir au modèle précédent » dans Atelier.';
        if (!await confirmAction('Adopter malgré cette baisse ?', message, 'Adopter cette version')) return;
        if (!candidate || candidate.runId !== adopting.runId) return;
      }
      try {
        var previous = state.model ? clone(state.model) : null;
        var reason = regression ? 'Adoptée par l’utilisateur après examen explicite de la baisse du contrôle : ' + adopting.before.correct + '/' + adopting.before.total + ' → ' + adopting.after.correct + '/' + adopting.after.total + '.' : 'Adoptée par l’utilisateur après comparaison du jeu de contrôle.';
        var next = Object.assign({}, state, { model: adopting.model, previousModel: previous, events: state.events.slice(), meta: clone(state.meta), retention: clone(state.retention), trainingRuns: state.trainingRuns.map(function (run) { return run.id === adopting.runId ? Object.assign({}, run, { status: 'adopted', reason: reason }) : run; }) });
        Core.recordEvent(next, regression ? 'model_adopted_after_review' : 'model_adopted', 'user', reason + ' Version : ' + adopting.model.version + ' ; précédente : ' + (previous ? previous.version : 'aucune') + '. Formulations personnelles : ' + personal.before.correct + '/' + personal.before.total + ' → ' + personal.after.correct + '/' + personal.after.total + '.');
        Core.exportState(next); state = next;
        evaluation = adopting.after; evaluationAt = adopting.evaluatedAt; evaluationModelVersion = adopting.model.version; candidate = null;
        renderCandidate(); renderHistory(); renderStats(); renderExamples(); renderChat(false); $('evaluation-result').replaceChildren(evaluationView(evaluation));
        var saved = await save();
        if (!state.model || state.model.version !== adopting.model.version) { evaluation = null; evaluationAt = null; evaluationModelVersion = null; $('evaluation-result').textContent = 'La modification a été annulée pour conserver un état restaurable.'; return; }
        toast(saved ? 'Nouvelle version active et enregistrée. Vous pouvez l’essayer dans la conversation.' : 'Nouvelle version active dans cette session. Exportez votre travail avant de fermer.');
      } catch (error) { toast('Adoption impossible : ' + error.message); }
    });
    $('discard-button').addEventListener('click', function () { discardCandidate(); toast('Essai conservé dans l’historique, sans modifier le modèle actif.'); });
    $('evaluate-button').addEventListener('click', function () {
      evaluation = Core.evaluate(state.model); evaluationAt = now(); evaluationModelVersion = state.model ? state.model.version : null; $('evaluation-result').replaceChildren(evaluationView(evaluation));
      note('evaluation', 'user', 'Jeu de contrôle du modèle ' + (state.model ? state.model.version : 'non entraîné') + ' : ' + evaluation.correct + '/' + evaluation.total + '.');
      evaluation.results.forEach(function (item) { note('evaluation_case', 'system', JSON.stringify(item)); }); save();
    });
    $('selftest-button').addEventListener('click', function () {
      selfTests = Core.runSelfTests(); selfTests.executedAt = now(); var target = $('selftest-results'); target.replaceChildren();
      target.appendChild(el('div', 'test-summary', selfTests.passed + ' / ' + selfTests.total + ' contrôles réussis'));
      selfTests.results.forEach(function (item) { var row = el('div', 'test-row'); row.appendChild(el('span', '', item.name)); row.appendChild(el('span', 'test-result' + (item.passed ? '' : ' fail'), item.passed ? 'Réussi' : 'Échec')); target.appendChild(row); note('self_test_case', 'system', item.name + ' : ' + (item.passed ? 'réussi' : 'échec') + '. ' + item.detail); }); save();
    });
    $('rollback-button').addEventListener('click', async function () {
      if (!state.previousModel) return;
      if (!await confirmAction('Revenir au modèle précédent ?', 'Les souvenirs et les exemples restent conservés. Le classifieur actif sera remplacé par la version précédente.', 'Revenir à la précédente')) return;
      if (candidate) discardCandidate('Essai écarté lors du retour à un autre modèle actif.');
      var current = state.model, previous = state.previousModel; state.model = previous; state.previousModel = current;
      note('model_rollback', 'user', 'Retour du modèle ' + (current ? current.version : 'aucun') + ' au modèle ' + previous.version + '.');
      evaluation = null; evaluationAt = null; evaluationModelVersion = null; $('evaluation-result').textContent = 'Le modèle a changé. Relancez l’évaluation.'; renderStats(); renderHistory(); renderExamples(); renderChat(false); save(); toast('Modèle précédent restauré.');
    });
    $('export-json').addEventListener('click', function () { try { note('json_export_requested', 'user', 'Export demandé de la sauvegarde JSON restaurable.'); download(Core.exportState(state), 'application/json;charset=utf-8', 'sauvegarde-poi-' + now().slice(0, 10) + '.json'); save(); toast('Sauvegarde JSON préparée.'); } catch (error) { toast(error.message); } });
    $('import-button').addEventListener('click', function () { $('import-input').click(); });
    $('import-input').addEventListener('change', function () { restoreFile(this.files[0]); });
    $('offline-retry').addEventListener('click', prepareOffline);
    $('reset-button').addEventListener('click', async function () {
      if (!await confirmAction('Réinitialiser tout l’atelier ?', 'Les conversations, souvenirs, exemples ajoutés, modèles, historique et documents joints locaux, avec leurs fichiers et textes extraits, seront effacés de cet atelier. Les fichiers d’origine sur votre appareil ne seront pas modifiés. Les exemples de départ seront rétablis. Exportez d’abord si vous souhaitez conserver votre travail.', 'Tout réinitialiser')) return;
      stopDocumentImport(true); selectedDocumentIds.clear(); documentFeedback('');
      state = Core.createState(); candidate = null; evaluation = null; evaluationAt = null; evaluationModelVersion = null; selfTests = null; writeBlocked = false; warn(''); note('workshop_reset', 'user', 'Nouvel état vide après réinitialisation volontaire.');
      renderAll(); $('evaluation-result').textContent = 'Aucune évaluation lancée dans cette session.'; $('selftest-results').textContent = 'Aucun contrôle exécuté dans cette session.'; await save(); navigate('conversation', true); toast('Atelier réinitialisé.');
    });
    $('modal-cancel').addEventListener('click', function () { closeModal(false); }); $('modal-confirm').addEventListener('click', function () { closeModal(true); });
    $('modal-backdrop').addEventListener('click', function (event) { if (event.target === this) closeModal(false); });
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('controllerchange', function () { prepareOffline(); });
    window.addEventListener('pagehide', function () { stopDocumentImport(true); releaseDocumentPreviews(); });
    window.addEventListener('pageshow', function (event) { if (event.persisted && state) renderDocuments(); });
    document.addEventListener('keydown', function (event) { if ($('modal-backdrop').hidden) return; if (event.key === 'Escape') { event.preventDefault(); closeModal(false); } if (event.key === 'Tab') { var a = $('modal-cancel'), b = $('modal-confirm'); if (event.shiftKey && document.activeElement === a) { event.preventDefault(); b.focus(); } else if (!event.shiftKey && document.activeElement === b) { event.preventDefault(); a.focus(); } } });
  }

  async function boot() {
    if (!Core || !Exporter) { warn('Certains fichiers de l’application n’ont pas été chargés. Rechargez cette page avec une connexion active.'); $('save-label').textContent = 'Chargement incomplet'; return; }
    await openStorage(); state = await loadState(); lastValidSnapshot = Core.exportState(state);
    Core.INTENTS.forEach(function (intent) { var option = document.createElement('option'); option.value = intent.id; option.textContent = intent.label + ' — ' + intent.description; $('example-intent').appendChild(option); });
    bind(); renderAll(); navigate(initialTab, false);
    note('session_opened', 'system', 'Ouverture de l’atelier version ' + APP_VERSION + ' ; moteur ' + Core.VERSION + ' ; stockage ' + storageMode + '.');
    if (!writeBlocked) save(); else $('save-label').textContent = 'Sauvegarde précédente préservée · écriture suspendue';
    prepareOffline();
  }
  boot().catch(function (error) { warn('Le démarrage a été interrompu : ' + error.message + '. Rechargez la page.'); });
}());
