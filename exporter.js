/* POI — detailed, local-only exports. No network requests or dependencies. */
(function (root, factory) {
  var api = factory(function () {
    if (root && root.POICore) return root.POICore;
    if (typeof require === 'function') {
      try { return require('./engine.js'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
    }
    return null;
  });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.POIExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (getCore) {
  'use strict';
  var VERSION = '0.3.0';
  var encoder = new TextEncoder();
  var INTENT_LABELS = {
    identity: 'Identité', role: 'Rôle', capabilities: 'Capacités',
    remember: 'Mémorisation', recall: 'Rappel', greeting: 'Salutation'
  };
  var SOURCE_LABELS = {rule: 'Règle programmée', model: 'Classifieur appris', memory: 'Mémoire', document: 'Document joint', generation: 'Génération locale', unknown: 'Demande non reconnue'};
  var STATUS_LABELS = {evaluated: 'Évalué', adopted: 'Adopté', rejected: 'Refusé', rolled_back: 'Retour à la version précédente', candidate: 'Candidat'};
  var LIMITATIONS = [
    'Cet export décrit toutes les données présentes dans l’état au moment de sa création. Il ne reconstitue pas les données supprimées, les échanges absents ni les éléments écartés par les limites de conservation.',
    'Les faits mémorisés sont des déclarations de l’utilisateur. Ils ne sont pas vérifiés par une source externe et ne constituent pas un apprentissage des paramètres.',
    'Les règles programmées et les réponses préparées fonctionnent indépendamment de l’entraînement. Le petit modèle apprend à classer des formulations parmi six intentions.',
    'Un score de classification n’est pas une probabilité que la réponse soit vraie. Les refus et les résultats inconnus doivent être conservés dans l’interprétation des mesures.',
    'Les mesures sur les exemples d’entraînement et sur le petit jeu d’évaluation ont des usages différents. Un résultat élevé sur ce jeu limité ne démontre pas une compréhension générale du français.',
    'Les évaluations utilisées pour choisir une version ne constituent plus un test final indépendant. Prévoir d’autres formulations pour une évaluation finale.',
    'Les réponses de source « document » sélectionnent des phrases sources selon la question. Leurs résumés sont extractifs et leurs analyses fournissent des mesures lexicales. Le document original, le texte extrait, les limites de lecture et les citations disponibles sont conservés.',
    'Les réponses de source « generation » sont rédigées localement par un modèle de langage préentraîné. Elles peuvent contenir des erreurs. Les citations associées désignent les passages fournis au modèle ; elles ne garantissent pas que chaque affirmation produite soit établie par ces passages. Une sélection de contexte ne représente pas le texte intégral du document.',
    'Les poids du modèle génératif préentraîné sont soit conservés dans OPFS, soit lus depuis un fichier GGUF choisi pour la session, sans copie dans OPFS. Ils ne sont pas inclus dans la sauvegarde personnelle. La révision, le fichier et son empreinte SHA-256 permettent de récupérer le même modèle. Cela ne garantit pas une nouvelle réponse identique ; les paramètres d’échantillonnage et l’ensemble du contexte d’exécution ne sont pas nécessairement conservés.',
    'La reconnaissance de texte peut commettre des erreurs. Les références renvoient aux pages lues du PDF ; les autres formats utilisent des segments de texte et non une pagination imprimée. Une lecture partielle est signalée et ne représente pas le document entier.',
    'Le journal rapporte des opérations observables. Il ne décrit aucun raisonnement interne privé, aucune expérience subjective ni une introspection du système.',
    'Les fichiers exportés peuvent contenir vos informations personnelles, conversations et exemples. Conservez-les dans un emplacement de confiance ; les fichiers ne sont pas chiffrés.',
    'Le programme n’envoie pas le contenu de cet export à un service externe. Le stockage local du navigateur peut être effacé ; l’export est une copie indépendante.'
  ];
  function arr(value) { return Array.isArray(value) ? value : []; }
  function own(object, key) { return object && Object.prototype.hasOwnProperty.call(object, key); }
  function valueOr(value, fallback) { return value === null || value === undefined || value === '' ? fallback : value; }
  function text(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
  function escapeHTML(value) {
    return text(value).replace(/[&<>"']/g, function (char) { return {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]; });
  }
  function json(value) { return JSON.stringify(value, null, 2); }
  function pretty(value) { return escapeHTML(json(value)); }
  function label(map, value) { return own(map, value) ? map[value] : valueOr(value, 'Non indiqué'); }
  function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
  function percent(value) { return finite(value) ? (value * 100).toLocaleString('fr-FR', {maximumFractionDigits: 2}) + ' %' : 'Non mesuré'; }
  function dateLabel(value) {
    if (!value) return 'Non renseignée';
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? text(value) : date.toLocaleString('fr-FR', {year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit', timeZone:'Europe/Paris'}) + ' (Paris)';
  }
  function cleanSerializable(value, seen) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'object') return undefined;
    seen = seen || [];
    if (seen.indexOf(value) !== -1) return '[Référence circulaire non exportée]';
    seen.push(value);
    var result;
    if (Array.isArray(value)) result = value.map(function (item) { var clean = cleanSerializable(item, seen); return clean === undefined ? null : clean; });
    else {
      result = Object.create(null);
      Object.keys(value).forEach(function (key) {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') return;
        var clean = cleanSerializable(value[key], seen);
        if (clean !== undefined) result[key] = clean;
      });
    }
    seen.pop();
    return result;
  }
  function scalarFields(value, allowed) {
    var result = {};
    allowed.forEach(function (key) {
      if (!own(value, key)) return;
      var item = value[key];
      if (item === null || typeof item === 'boolean' || finite(item)) result[key] = item;
      else if (typeof item === 'string') result[key] = item.slice(0, 1500);
    });
    return result;
  }
  function generationStatus(value) {
    if (!value || typeof value !== 'object') return null;
    var result = scalarFields(value, ['version','runtimeVersion','phase','supported','supportedFile','cachedSupported','unsupportedReason','ready','cached','storage','busy','error']);
    if (value.model) result.model = scalarFields(value.model, ['id','name','file','revision','bytes','sha256','quantization','url']);
    if (value.limits) result.limits = scalarFields(value.limits, ['contextTokens','outputTokens','contextCharacters','promptCharacters','answerCharacters']);
    return result;
  }
  function generationInventory(state, context) {
    var messages = arr(state.messages).filter(function (message) { return message.source === 'generation' && message.generation; }), models = [];
    var status = context.generation || null;
    function addModel(value, configured) {
      var metadata = scalarFields(value, ['runtime','runtimeVersion','modelId','modelRevision','modelFile','modelSha256','bytes','quantization']);
      if (!metadata.modelId || !metadata.modelRevision || !metadata.modelFile || !metadata.modelSha256) return;
      var existing = models.find(function (model) { return ['runtime','runtimeVersion','modelId','modelRevision','modelFile','modelSha256'].every(function (key) { return model[key] === metadata[key]; }); });
      if (existing) { if (configured) existing.configuredAtExport = true; if (metadata.bytes !== undefined) existing.bytes = metadata.bytes; return; }
      metadata.configuredAtExport = Boolean(configured); metadata.weightsIncluded = false;
      if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(metadata.modelId) && /^[a-f0-9]{40}$/.test(metadata.modelRevision) && /^[A-Za-z0-9_.-]+\.gguf$/.test(metadata.modelFile)) {
        metadata.downloadURL = 'https://huggingface.co/' + metadata.modelId + '/resolve/' + metadata.modelRevision + '/' + metadata.modelFile;
      }
      models.push(metadata);
    }
    messages.forEach(function (message) { addModel(message.generation, false); });
    if (status && status.model) addModel({ runtime:'wllama',runtimeVersion:status.runtimeVersion,modelId:status.model.id,modelRevision:status.model.revision,modelFile:status.model.file,modelSha256:status.model.sha256,bytes:status.model.bytes,quantization:status.model.quantization }, true);
    var core = getCore();
    return { format:'poi-local-generation',formatVersion:1,modelWeightsIncluded:false,modelStorage:'OPFS du navigateur ou fichier GGUF choisi pour la session ; poids toujours distincts de la sauvegarde personnelle',
      personalStateLimitBytes:core && core.LIMITS ? core.LIMITS.importBytes : null, statusAtExport:status, models:models,
      restoration:'Importer sauvegarde-poi.json restaure les messages et leurs métadonnées, sans télécharger le modèle. Sur un nouvel appareil ou après effacement du stockage, préparer séparément la génération locale avec le même fichier à la révision indiquée, puis vérifier son SHA-256. Le modèle peut être conservé dans OPFS ou choisi comme fichier GGUF pour la session. Dans le mode fichier, sélectionner à nouveau ce GGUF depuis Fichiers à chaque nouvelle session ; il n’est pas copié dans OPFS. Le statut exporté décrit le mode courant, sans l’attribuer rétroactivement aux anciens messages. Si la version de POI propose une autre révision, conserver cette distinction ; ne pas présenter ce modèle différent comme identique.',
      citationScope:'Passages fournis au modèle ; aucune garantie que toutes les affirmations générées soient appuyées par ces passages.',
      messages:messages.map(function (message) { return {messageId:message.id,createdAt:message.createdAt,generation:scalarFields(message.generation,['runtime','runtimeVersion','modelId','modelRevision','modelFile','modelSha256','local','inputTokens','outputTokens','contextCharacters','durationMs','finishReason','citationScope']),citations:arr(message.citations)}; }) };
  }
  function getContext(context) {
    var result = {};
    ['createdAt','appVersion','coreVersion','selfTests','evaluation','evaluationAt','evaluationModelVersion','offline','storage','userAgent','language','platform','display','diagnostics','notes','trainingPolicy','limits'].forEach(function (key) {
      if (context && own(context,key)) result[key] = cleanSerializable(context[key]);
    });
    if (context && own(context, 'generation')) result.generation = generationStatus(context.generation);
    if (!result.createdAt) result.createdAt = new Date().toISOString();
    if (Number.isNaN(new Date(result.createdAt).getTime())) throw new Error('La date de l’export est invalide.');
    result.createdAt = new Date(result.createdAt).toISOString();
    return result;
  }
  function countsFor(state) {
    return {
      messages: arr(state.messages).length,
      userMessages: arr(state.messages).filter(function (m) { return m.role === 'user'; }).length,
      assistantMessages: arr(state.messages).filter(function (m) { return m.role === 'assistant'; }).length,
      generatedMessages: arr(state.messages).filter(function (m) { return m.source === 'generation'; }).length,
      facts: arr(state.facts).length,
      examples: arr(state.examples).length,
      starterExamples: arr(state.examples).filter(function (e) { return e.origin === 'starter'; }).length,
      userExamples: arr(state.examples).filter(function (e) { return e.origin !== 'starter'; }).length,
      trainingRuns: arr(state.trainingRuns).length,
      events: arr(state.events).length,
      documents: arr(state.documents).length,
      documentOriginalBytes: arr(state.documents).reduce(function (sum, doc) { return sum + (doc.size || 0); }, 0),
      documentPages: arr(state.documents).reduce(function (sum, doc) { return sum + arr(doc.pages).length; }, 0),
      documentCharacters: arr(state.documents).reduce(function (sum, doc) { return sum + arr(doc.pages).reduce(function (chars, page) { return chars + text(page.text).length; }, 0); }, 0),
      currentParameters: parameterRows(state.model, 'actuel').length,
      previousParameters: parameterRows(state.previousModel, 'précédent').length
    };
  }
  function csvCell(value) {
    var string = text(value);
    if (typeof value !== 'number' && (/^[\t\r\n]/.test(string) || /^[ \t\r\n]*[=+@-]/.test(string))) string = "'" + string;
    return '"' + string.replace(/"/g, '""') + '"';
  }
  function csv(headers, rows) {
    return '\ufeff' + [headers].concat(rows).map(function (row) { return row.map(csvCell).join(';'); }).join('\r\n') + '\r\n';
  }
  function modelEntries(state) {
    var entries = [];
    if (state.model) entries.push({scope:'actuel', model:state.model, runId:''});
    if (state.previousModel) entries.push({scope:'précédent', model:state.previousModel, runId:''});
    arr(state.trainingRuns).forEach(function (run) {
      if (run.parametersSnapshot) entries.push({scope:'instantané entraînement', model:run.parametersSnapshot, runId:valueOr(run.id,'')});
    });
    return entries;
  }
  function parameterRows(model, scope, runId) {
    if (!model || typeof model !== 'object') return [];
    var rows = [];
    var featureCount = Number(model.featureCount) || arr(model.vocabulary).length;
    var weights = arr(model.weights);
    weights.forEach(function (weight, index) {
      var classIndex = featureCount ? Math.floor(index / featureCount) : '';
      var featureIndex = featureCount ? index % featureCount : index;
      rows.push([scope, valueOr(runId,''), valueOr(model.version,''), 'poids', index, classIndex, valueOr(arr(model.classes)[classIndex],''), featureIndex, valueOr(arr(model.vocabulary)[featureIndex],''), weight]);
    });
    arr(model.bias).forEach(function (bias, index) {
      rows.push([scope, valueOr(runId,''), valueOr(model.version,''), 'biais', index, index, valueOr(arr(model.classes)[index],''), '', '', bias]);
    });
    return rows;
  }
  function modelMetadata(model) {
    if (!model) return null;
    var result = {};
    Object.keys(model).forEach(function (key) { if (key !== 'weights' && key !== 'bias' && key !== 'vocabulary') result[key] = model[key]; });
    result.vocabularySize = arr(model.vocabulary).length;
    result.weightsCount = arr(model.weights).length;
    result.biasCount = arr(model.bias).length;
    return result;
  }
  function evaluationEntries(state, context) {
    var entries = [];
    if (context.evaluation) entries.push({scope:'modèle actuel au moment de l’export', runId:'', phase:'export', evaluation:context.evaluation});
    arr(state.trainingRuns).forEach(function (run) {
      if (run.evaluationBefore) entries.push({scope:'entraînement', runId:valueOr(run.id,''), phase:'avant', evaluation:run.evaluationBefore});
      if (run.evaluationAfter) entries.push({scope:'entraînement', runId:valueOr(run.id,''), phase:'après', evaluation:run.evaluationAfter});
    });
    return entries;
  }
  function table(headers, rows, emptyMessage) {
    if (!rows.length) return '<p class="empty">' + escapeHTML(emptyMessage || 'Aucune donnée enregistrée.') + '</p>';
    return '<div class="table-wrap"><table><thead><tr>' + headers.map(function (h) { return '<th scope="col">' + escapeHTML(h) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.map(function (row) {
      return '<tr>' + row.map(function (cell) { return '<td>' + escapeHTML(cell) + '</td>'; }).join('') + '</tr>';
    }).join('') + '</tbody></table></div>';
  }
  function keyValues(object) {
    if (!object || typeof object !== 'object') return '<p class="empty">Non renseigné.</p>';
    return table(['Champ','Valeur'], Object.keys(object).map(function (key) { return [key, typeof object[key] === 'object' ? json(object[key]) : object[key]]; }));
  }
  function details(title, body, open) { return '<details' + (open ? ' open' : '') + '><summary>' + escapeHTML(title) + '</summary><div class="details-body">' + body + '</div></details>'; }
  function evaluationHTML(evaluation) {
    if (!evaluation) return '<p class="empty">Évaluation non fournie ; aucun résultat n’est supposé.</p>';
    return '<p><strong>' + escapeHTML(valueOr(evaluation.correct,'?')) + ' / ' + escapeHTML(valueOr(evaluation.total,'?')) + '</strong> cas corrects — ' + escapeHTML(percent(evaluation.accuracy)) + '.</p>' + table(
      ['Formulation','Intention attendue','Prédiction','Résultat','Score'],
      arr(evaluation.results).map(function (result) { return [result.text, label(INTENT_LABELS,result.expected), label(INTENT_LABELS,result.predicted), result.correct === true ? 'Correct' : result.correct === false ? 'Incorrect ou refusé' : 'Non renseigné', valueOr(result.score,'')]; }),
      'Aucun détail par cas fourni.'
    ) + details('Données exactes de l’évaluation', '<pre>' + pretty(evaluation) + '</pre>');
  }
  function reportModel(entry) {
    var model = entry.model;
    return '<article class="block"><h3>Modèle ' + escapeHTML(entry.scope) + ' — version ' + escapeHTML(valueOr(model.version,'non indiquée')) + '</h3>' +
      (entry.runId ? '<p>Entraînement : <code>' + escapeHTML(entry.runId) + '</code></p>' : '') +
      keyValues(modelMetadata(model)) +
      details('Vocabulaire complet (' + arr(model.vocabulary).length + ' caractéristiques)', table(['Index','Caractéristique'], arr(model.vocabulary).map(function (word,index) { return [index,word]; }))) +
      details('Tous les paramètres (' + parameterRows(model,entry.scope,entry.runId).length + ')', table(['Type','Index','Classe','Caractéristique','Valeur exacte'], parameterRows(model,entry.scope,entry.runId).map(function (row) { return [row[3],row[4],row[6],row[8],row[9]]; }))) +
      details('Objet modèle intégral', '<pre>' + pretty(model) + '</pre>') + '</article>';
  }
  function fileBytes(content) { return content instanceof Uint8Array ? content : encoder.encode(text(content)); }
  function originalBytes(doc) {
    var binary = atob(doc.dataBase64 || '');
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    if (bytes.length !== doc.size) throw new Error('Taille incohérente du document : ' + doc.name);
    return bytes;
  }
  function documentMetadata(doc) {
    var metadata = {};
    Object.keys(doc).forEach(function (key) { if (key !== 'dataBase64') metadata[key] = doc[key]; });
    return metadata;
  }
  function documentPaths(doc, index) {
    var filename = text(doc.name).normalize('NFC').replace(/[\x00-\x1f\x7f/\\:<>"|?*]/g, '_').replace(/^\.+/, '_').slice(0,150) || 'document';
    var prefix = String(index + 1).padStart(3, '0') + '-';
    return {original:'documents/originaux/' + prefix + filename, extracted:'documents/textes/' + prefix + filename + '.txt'};
  }
  function documentReport(doc, index) {
    var paths = documentPaths(doc, index);
    var metadata = documentMetadata(doc);
    delete metadata.pages;
    return '<article class="block"><h3>' + escapeHTML(doc.name) + '</h3>' +
      keyValues(metadata) + '<p>Original dans l’archive : <code>' + escapeHTML(paths.original) + '</code>. Texte extrait : <code>' + escapeHTML(paths.extracted) + '</code>.</p>' +
      details('Texte intégral extrait (' + arr(doc.pages).length + ' pages ou segments)', arr(doc.pages).map(function (page) {
        return '<h4>' + (doc.kind === 'pdf' ? 'Page ' : 'Segment ') + escapeHTML(page.number) + '</h4><pre>' + escapeHTML(page.text) + '</pre>';
      }).join('') || '<p class="empty">Aucun texte extrait.</p>') + '</article>';
  }
  function generateReport(state, rawContext) {
    state = state || {};
    var context = getContext(rawContext);
    var counts = countsFor(state);
    var identity = state.identity || {};
    var generation = generationInventory(state, context);
    var readableState = Object.assign({}, state, {documents:arr(state.documents).map(documentMetadata)});
    var core = getCore();
    var version = context.appVersion || (core && core.VERSION) || VERSION;
    var transcript = arr(state.messages).map(function (message,index) {
      return '<article class="message ' + (message.role === 'user' ? 'user' : 'assistant') + '"><div class="message-head"><strong>' + escapeHTML(valueOr(message.speakerName, message.role === 'user' ? 'Utilisateur' : message.role === 'assistant' ? 'Assistant' : valueOr(message.role,'Auteur inconnu'))) + '</strong><span>' + escapeHTML(dateLabel(message.createdAt)) + '</span></div><p class="message-text">' + escapeHTML(message.text) + '</p>' +
        '<p class="metadata">Message ' + (index + 1) + ' · ' + escapeHTML(message.id) + (message.source ? ' · ' + escapeHTML(label(SOURCE_LABELS,message.source)) : '') + (message.intent ? ' · ' + escapeHTML(label(INTENT_LABELS,message.intent)) : '') + (message.modelVersion ? ' · modèle ' + escapeHTML(message.modelVersion) : '') + (finite(message.score) ? ' · score ' + escapeHTML(message.score) : '') + (arr(message.documentIds).length ? ' · documents sélectionnés : ' + escapeHTML(message.documentIds.join(', ')) : '') + '</p>' +
        (message.explanation ? '<p class="explanation">' + escapeHTML(message.explanation) + '</p>' : '') +
        (message.generation ? details('Provenance de la génération locale', keyValues(message.generation)) : '') +
        (arr(message.citations).length ? details(message.source === 'generation' ? 'Passages fournis au modèle' : 'Sources de la réponse', (message.source === 'generation' ? '<p>Ces passages étaient présents dans le contexte du modèle. Leur conservation ne certifie pas toutes les affirmations de la réponse.</p>' : '') + table(['Document','Page ou segment','Passage exact'], message.citations.map(function (citation) { return [citation.name,citation.page,citation.excerpt]; }))) : '') +
        details('Enregistrement exact de ce message', '<pre>' + pretty(message) + '</pre>') + '</article>';
    }).join('');
    var trainings = arr(state.trainingRuns).map(function (run,index) {
      return '<article class="block"><h3>Entraînement ' + (index + 1) + ' — ' + escapeHTML(label(STATUS_LABELS,run.status)) + '</h3><p>' + escapeHTML(dateLabel(run.createdAt)) + ' · <code>' + escapeHTML(run.id) + '</code></p>' +
        (run.reason ? '<p>' + escapeHTML(run.reason) + '</p>' : '') +
        keyValues({versionModele:run.modelVersion,decision:run.status,configuration:run.config,mesures:run.metrics}) +
        '<h4>Évaluation avant</h4>' + evaluationHTML(run.evaluationBefore) + '<h4>Évaluation après</h4>' + evaluationHTML(run.evaluationAfter) +
        details('Exemples utilisés lors de cet entraînement (' + arr(run.examplesSnapshot).length + ')', table(['Identifiant','Formulation','Intention','Origine'], arr(run.examplesSnapshot).map(function (example) { return [example.id,example.text,label(INTENT_LABELS,example.intent),example.origin]; }), 'L’instantané des exemples n’est pas fourni.')) +
        details('Enregistrement intégral de cet entraînement', '<pre>' + pretty(run) + '</pre>') + '</article>';
    }).join('');
    var diagnostics = context.selfTests;
    var diagnosticsHTML = diagnostics ? '<p><strong>' + escapeHTML(valueOr(diagnostics.passed,'?')) + ' / ' + escapeHTML(valueOr(diagnostics.total,'?')) + '</strong> contrôles réussis.</p>' + table(['Contrôle','Résultat','Détail'], arr(diagnostics.results).map(function (r) { return [r.name, r.passed === true ? 'Réussi' : r.passed === false ? 'Échec' : 'Non renseigné',r.detail]; })) + details('Résultat exact des contrôles', '<pre>' + pretty(diagnostics) + '</pre>') : '<p class="empty">Aucun résultat de contrôle fourni pour cet export. Aucun test n’a été exécuté automatiquement par l’exporteur.</p>';
    var retention = state.retention || {};
    var dropped = Object.keys(retention).some(function (key) { return finite(retention[key]) && retention[key] > 0; });
    var body = '<header class="hero"><p class="eyebrow">POI · ATELIER D’IA</p><h1>Carnet d’apprentissage</h1><p class="subtitle">Export détaillé de toutes les données conservées</p><p>' + escapeHTML(dateLabel(context.createdAt)) + '</p><p class="metadata">Application ' + escapeHTML(version) + ' · schéma ' + escapeHTML(valueOr(state.schemaVersion,'non renseigné')) + ' · exporteur ' + VERSION + '</p></header>' +
      '<div class="notice"><strong>Une copie personnelle, non chiffrée.</strong> Ce rapport contient les conversations, faits, exemples et résultats présents dans votre application. Vérifiez son contenu avant de le partager.</div>' +
      '<nav class="contents" aria-label="Sommaire"><a href="#synthese">Vue d’ensemble</a><a href="#identite">Identité</a><a href="#conversation">Conversation</a><a href="#documents">Documents</a><a href="#memoire">Mémoire</a><a href="#exemples">Exemples</a><a href="#apprentissage">Apprentissages</a><a href="#modeles">Classifieur</a><a href="#generation">Génération locale</a><a href="#evaluation">Évaluation</a><a href="#journal">Journal</a><a href="#diagnostics">Contrôles</a><a href="#contexte">Contexte</a><a href="#limites">Limites</a></nav>' +
      '<section id="synthese"><h2>Vue d’ensemble</h2><div class="stats">' + [[counts.messages,'messages'],[counts.facts,'faits mémorisés'],[counts.examples,'exemples'],[counts.trainingRuns,'entraînements']].map(function (stat) { return '<div><strong>' + stat[0] + '</strong><span>' + stat[1] + '</span></div>'; }).join('') + '</div><p>Ce rapport distingue les <strong>règles programmées</strong>, la <strong>mémoire de faits</strong> et les <strong>paramètres appris</strong>. Ces mécanismes sont différents et aucun ne prouve, à lui seul, une maîtrise générale du langage.</p>' +
      keyValues({creationEtat:state.meta && state.meta.createdAt,derniereModification:state.meta && state.meta.updatedAt,dateExportUTC:context.createdAt,modeleEntraine:!!state.model,versionCourante:state.model && state.model.version,versionPrecedente:state.previousModel && state.previousModel.version}) +
      '<h3>Conservation de l’historique</h3><p>' + (dropped ? 'Des éléments ont été écartés par les limites de conservation. Les compteurs ci-dessous indiquent les pertes connues.' : 'Les compteurs ne signalent pas d’élément écarté par les limites de conservation. Cela ne permet pas de reconstituer des données supprimées volontairement ou perdues avant cet état.') + '</p>' + keyValues(retention) + '</section>' +
      '<section id="identite"><h2>Identité et périmètre</h2>' + keyValues(identity) + '<p>Les réponses sur l’identité utilisent cet état programmé. Les messages de l’utilisateur et de l’assistant sont distingués par leur rôle enregistré.</p>' + table(['Intention','Identifiant'],Object.keys(INTENT_LABELS).map(function (id) { return [INTENT_LABELS[id],id]; })) + '<p>Le petit modèle choisit parmi ces intentions. Les règles contrôlent les commandes de mémoire ; un texte non pris en charge peut être refusé.</p></section>' +
      '<section id="conversation"><h2>Conversation intégrale conservée</h2>' + (transcript || '<p class="empty">Aucun message conservé.</p>') + '</section>' +
      '<section id="documents"><h2>Documents et textes extraits</h2><p>' + counts.documents + ' document(s), ' + counts.documentOriginalBytes + ' octets originaux, ' + counts.documentPages + ' pages ou segments conservés, ' + counts.documentCharacters + ' caractères extraits. Les citations et les limites de lecture restent dans les réponses et leurs explications. Les fichiers d’origine figurent dans l’archive et dans la sauvegarde restaurable.</p><p>Le texte d’un document est un contenu à examiner : il ne constitue pas une consigne exécutée par POI et n’entraîne pas automatiquement son classifieur.</p>' + (arr(state.documents).map(documentReport).join('') || '<p class="empty">Aucun document joint conservé.</p>') + '</section>' +
      '<section id="memoire"><h2>Mémoire des faits</h2><p>Les valeurs ci-dessous sont enregistrées comme déclarations de l’utilisateur. Leur présence en mémoire ne signifie pas qu’elles ont été vérifiées ni qu’un poids du modèle a changé.</p>' + table(['Clé','Valeur','Auteur','Création','Modification','Identifiant'],arr(state.facts).map(function (fact) { return [fact.key,fact.value,fact.author,dateLabel(fact.createdAt),dateLabel(fact.updatedAt),fact.id]; })) + '</section>' +
      '<section id="exemples"><h2>Exemples d’apprentissage actuels</h2><p>Le jeu actuel peut différer du jeu employé lors d’un entraînement précédent. Les instantanés enregistrés se trouvent dans la section Apprentissages.</p>' + table(['Formulation','Intention','Origine','Identifiant','Création'],arr(state.examples).map(function (example) { return [example.text,label(INTENT_LABELS,example.intent),example.origin,example.id,valueOr(example.createdAt,'Non renseignée')]; })) + '</section>' +
      '<section id="apprentissage"><h2>Historique des apprentissages</h2><p>Les pertes et exactitudes d’entraînement décrivent l’ajustement aux exemples utilisés ; l’exactitude d’entraînement mesure la première catégorie prédite, avant les seuils de refus. Les évaluations avant/après portent sur le jeu de contrôle fourni et comptent les refus comme des réponses incorrectes. Les nombres absents restent non mesurés.</p>' + (trainings || '<p class="empty">Aucun entraînement conservé. Le modèle peut encore être non entraîné.</p>') + '</section>' +
      '<section id="modeles"><h2>Paramètres et configuration du classifieur</h2><p>Les poids, biais et caractéristiques du classifieur sont reproduits sans arrondi volontaire ni suppression. Les CSV permettent de les analyser ; les objets exacts sont également inclus dans les fichiers JSON.</p>' + (modelEntries(state).map(reportModel).join('') || '<p class="empty">Aucun modèle appris n’est enregistré.</p>') + '</section>' +
      '<section id="generation"><h2>Génération locale par modèle préentraîné</h2><p>' + counts.generatedMessages + ' réponse(s) générée(s) conservée(s). Ce mécanisme de rédaction est distinct du classifieur entraîné dans POI. Les poids du générateur ne sont ni réentraînés par la conversation ni inclus dans cette sauvegarde personnelle.</p>' +
      '<p>' + escapeHTML(generation.restoration) + '</p><p>Les révisions et empreintes ci-dessous identifient les fichiers de modèle. Récupérer le même fichier ne garantit pas une réponse identique lors d’un nouveau calcul.</p>' +
      (generation.models.length ? generation.models.map(function (model) { return '<article class="block"><h3>' + escapeHTML(model.modelId) + '</h3>' + keyValues(model) + '</article>'; }).join('') : '<p class="empty">Aucune utilisation ni configuration de modèle génératif n’a été fournie pour cet export.</p>') +
      (generation.statusAtExport ? details('État du moteur fourni au moment de l’export', keyValues(generation.statusAtExport)) : '') +
      '<p>Les métadonnées exactes sont dans <code>generation-locale.json</code> et dans chaque message concerné de la sauvegarde. Les citations correspondent aux passages fournis au modèle, sans garantir toutes ses affirmations.</p></section>' +
      '<section id="evaluation"><h2>Évaluation disponible au moment de l’export</h2>' + (context.evaluation ? '<p>Date de la mesure : ' + escapeHTML(dateLabel(context.evaluationAt || context.evaluation.evaluatedAt)) + ' · version évaluée : ' + escapeHTML(own(context,'evaluationModelVersion') ? (context.evaluationModelVersion === null ? 'modèle non entraîné' : context.evaluationModelVersion) : valueOr(context.evaluation.modelVersion,'Non renseignée')) + '.</p>' : '') + evaluationHTML(context.evaluation) + '<p>Ces résultats ne sont pas recalculés par l’exporteur. Ils sont ceux fournis par l’application ; vérifiez leur date et leur correspondance avec la version courante dans le contexte.</p></section>' +
      '<section id="journal"><h2>Journal intégral des opérations conservées</h2>' + table(['Date','Type','Auteur','Détail','Message lié','Identifiant'],arr(state.events).map(function (event) { return [dateLabel(event.createdAt),event.type,event.author,typeof event.detail === 'object' ? json(event.detail) : event.detail,valueOr(event.messageId,''),event.id]; })) + '</section>' +
      '<section id="diagnostics"><h2>Contrôles disponibles</h2>' + diagnosticsHTML + '<p>Ces contrôles portent sur le périmètre indiqué. Ils ne remplacent pas l’essai sur votre propre iPhone et n’attestent pas une compréhension générale du français.</p></section>' +
      '<section id="contexte"><h2>Contexte technique fourni</h2><p>Le navigateur, la langue et les états de stockage ou de cache sont inclus uniquement lorsqu’ils ont été fournis. Un statut réseau ne prouve pas, à lui seul, que l’application fonctionne hors ligne.</p>' + keyValues(context) + '<h3>État complet exact</h3><p>La sauvegarde JSON contient l’état restaurable exact, fichiers originaux inclus en base64. Pour garder ce rapport lisible, seules ces données binaires sont retirées de la vue ci-dessous ; les textes extraits et métadonnées y restent présents.</p>' + details('Afficher les données lisibles de l’état', '<pre>' + pretty(readableState) + '</pre>') + '</section>' +
      '<section id="limites"><h2>Interprétation et limites</h2><ul>' + LIMITATIONS.map(function (limit) { return '<li>' + escapeHTML(limit) + '</li>'; }).join('') + '</ul><p>La sauvegarde restaurable se nomme <code>sauvegarde-poi.json</code>. Ouvrir ce rapport n’effectue aucune restauration et n’exécute aucun entraînement.</p></section>' +
      '<footer>POI — export local détaillé · ' + escapeHTML(context.createdAt) + '<br>Rapport autonome, sans script, police distante ni ressource externe.</footer>';
    return '<!DOCTYPE html>\n<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:"><title>POI — Carnet d’apprentissage — ' + escapeHTML(context.createdAt.slice(0,10)) + '</title><style>' +
      ':root{color-scheme:light;--ink:#202123;--muted:#6b6b6b;--line:#e5e5e5;--accent:#202123}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f7f7f8;color:var(--ink);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1080px;margin:auto;padding:40px 28px}.hero{padding:34px 0 28px;border-bottom:2px solid var(--accent)}.eyebrow{font-size:13px;letter-spacing:.12em;font-weight:750;color:var(--accent)}h1{font-size:42px;line-height:1.15;letter-spacing:-.04em;margin:12px 0}.subtitle{font-size:20px}.metadata{font-size:13px;color:var(--muted)}.notice{background:#f0f0f0;border:1px solid #dedede;border-radius:12px;padding:18px;margin:24px 0}.contents{display:flex;flex-wrap:wrap;gap:10px 18px;padding:10px 0 26px}.contents a{color:#202123}section{background:#fff;border:1px solid var(--line);border-radius:16px;padding:26px;margin:24px 0;scroll-margin-top:20px}h2{font-size:26px;line-height:1.25;letter-spacing:-.025em;margin:0 0 20px}h3{font-size:20px;margin:24px 0 12px}h4{font-size:17px;margin:20px 0 8px}p{margin:12px 0;overflow-wrap:anywhere}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px}.stats div{border:1px solid var(--line);border-radius:12px;padding:16px}.stats strong{display:block;font-size:30px;color:var(--accent);line-height:1.2}.stats span{font-size:13px;color:var(--muted)}.table-wrap{width:100%;overflow:auto;margin:16px 0}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--line);padding:11px 12px;white-space:pre-wrap;overflow-wrap:anywhere}th{font-size:13px;background:#f3f3f3;color:#3d3d3d;font-weight:700}td{max-width:440px}code{font-size:13px;background:#eeeeee;border-radius:4px;padding:2px 5px;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;background:#f5f5f5;border:1px solid var(--line);padding:16px;border-radius:9px;max-height:none}details{border:1px solid var(--line);border-radius:10px;margin:15px 0;background:#fff}summary{font-weight:650;padding:12px 15px;cursor:pointer}.details-body{padding:0 15px 15px}.message{padding:18px 20px;background:#ffffff;border:1px solid #e5e5e5;border-radius:14px;margin:16px 0}.message.user{background:#f5f5f5;border-color:var(--line)}.message-head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px}.message-head span{font-size:13px;color:var(--muted)}.message-text{white-space:pre-wrap}.explanation{border-left:3px solid #a6a6a6;padding-left:12px;font-size:14px}.empty{color:var(--muted);font-style:italic}.block{border-top:1px solid var(--line);padding-top:6px;margin-top:18px}li{margin:10px 0}footer{padding:22px 0 40px;color:var(--muted);font-size:13px}@media(max-width:600px){main{padding:20px 14px}.hero{padding-top:18px}h1{font-size:33px}.subtitle{font-size:18px}section{padding:19px 15px}h2{font-size:23px}.stats{grid-template-columns:repeat(2,1fr)}th,td{padding:9px 8px}.message{padding:15px}.contents{gap:9px 14px}.notice{padding:15px}}@media print{body{background:#fff;font-size:10pt}main{max-width:none;padding:0}.hero{padding-top:0}h1{font-size:28pt}h2{font-size:18pt}section{border:0;border-radius:0;padding:0;break-before:auto;margin:24pt 0}.contents{display:none}details>summary{display:none}details>.details-body{display:block!important}details{border:0}.details-body{padding:0}.table-wrap{overflow:visible}table{font-size:8pt}tr{break-inside:avoid}.message{break-inside:avoid}pre{font-size:7pt;max-height:none}.stats{grid-template-columns:repeat(4,1fr)}a{color:inherit;text-decoration:none}@page{margin:16mm}}' +
      '</style></head><body><main>' + body + '</main></body></html>';
  }
  function createFiles(state, rawContext) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Aucun état valide à exporter.');
    var context = getContext(rawContext);
    var core = getCore();
    var canonical = core && typeof core.exportState === 'function' ? core.exportState(state) : json(state);
    if (typeof canonical !== 'string') throw new Error('La sauvegarde ne peut pas être produite.');
    // Every representation uses the same validated state, including trimmed
    // legacy strings, so CSV, report and restoration cannot diverge.
    state = JSON.parse(canonical);
    var generation = generationInventory(state, context);
    var files = [];
    function add(name, role, content) { files.push({name:name,role:role,content:content}); }
    add('sauvegarde-poi.json','Sauvegarde complète et restaurable',canonical);
    add('rapport-poi-complet.html','Rapport lisible, autonome et imprimable',generateReport(state,context));
    add('conversation.csv','Tous les messages conservés et leurs métadonnées',csv(
      ['ordre','id','date_utc','role','nom_auteur_lors_du_message','version_modele','texte','source','intention','score','explication','documents_ids_json','citations_json','generation_modele','generation_revision','generation_jetons_entree','generation_jetons_sortie','generation_duree_ms','generation_json','enregistrement_complet_json'],
      arr(state.messages).map(function (m,i) { var g=m.generation||{}; return [i+1,m.id,m.createdAt,m.role,valueOr(m.speakerName,m.role === 'user' ? 'Utilisateur' : 'Assistant'),m.modelVersion,m.text,m.source,m.intent,m.score,m.explanation,arr(m.documentIds),arr(m.citations),g.modelId,g.modelRevision,g.inputTokens,g.outputTokens,g.durationMs,m.generation||null,JSON.stringify(m)]; })
    ));
    add('memoire.csv','Faits mémorisés, auteurs et dates',csv(
      ['id','cle','valeur','auteur','creation_utc','modification_utc','enregistrement_complet_json'],
      arr(state.facts).map(function (f) { return [f.id,f.key,f.value,f.author,f.createdAt,f.updatedAt,JSON.stringify(f)]; })
    ));
    add('exemples-apprentissage.csv','Jeu d’apprentissage actuel complet',csv(
      ['id','texte','intention','libelle_intention','origine','creation_utc','enregistrement_complet_json'],
      arr(state.examples).map(function (e) { return [e.id,e.text,e.intent,label(INTENT_LABELS,e.intent),e.origin,e.createdAt,JSON.stringify(e)]; })
    ));
    add('documents.csv','Inventaire des documents, provenance et couverture de lecture',csv(
      ['id','nom','type_mime','format','taille_original_octets','ajout_utc','sha256_enregistre','methode_extraction','pages_totales','pages_traitees','lecture_partielle','duree_ocr_ms','avertissements_json','original_dans_archive','texte_dans_archive'],
      arr(state.documents).map(function (doc,index) { var ex=doc.extraction||{}, paths=documentPaths(doc,index); return [doc.id,doc.name,doc.mime,doc.kind,doc.size,doc.addedAt,doc.sha256,ex.method,ex.totalPages,ex.processedPages,ex.truncated,ex.ocrDurationMs,ex.warnings,paths.original,paths.extracted]; })
    ));
    var documentPages = [];
    arr(state.documents).forEach(function (doc,index) {
      var paths = documentPaths(doc,index);
      add(paths.original,'Fichier original joint, conservé octet pour octet',originalBytes(doc));
      add(paths.extracted,'Texte extrait complet, séparé par page ou segment',[
        'POI — TEXTE EXTRAIT', 'Document : ' + doc.name, 'Identifiant : ' + doc.id,
        'Extraction : ' + json(doc.extraction), '',
        arr(doc.pages).map(function (page) { return '=== ' + (doc.kind === 'pdf' ? 'PAGE ' : 'SEGMENT ') + page.number + ' ===\n' + page.text; }).join('\n\n')
      ].join('\n'));
      arr(doc.pages).forEach(function (page) { documentPages.push([doc.id,doc.name,doc.kind === 'pdf' ? 'page' : 'segment',page.number,page.text.length,page.text]); });
    });
    add('pages-documents.csv','Texte complet extrait, page par page ou segment par segment',csv(
      ['document_id','nom_document','type_reference','numero','nombre_caracteres','texte_extrait'],documentPages
    ));
    add('documents.json','Métadonnées et textes extraits exacts ; originaux dans la sauvegarde et les fichiers joints',json(arr(state.documents).map(function (doc,index) { return {document:documentMetadata(doc),files:documentPaths(doc,index)}; })));
    add('entrainements.csv','Historique des entraînements et décisions',csv(
      ['id','date_utc','statut','version_modele','raison','epochs','nombre_exemples','perte_avant','perte_apres','exactitude_entrainement_avant','exactitude_entrainement_apres','duree_ms','exactitude_evaluation_avant','exactitude_evaluation_apres','configuration_json','exemples_utilises_json','mesures_completes_json','enregistrement_complet_json'],
      arr(state.trainingRuns).map(function (r) { var m=r.metrics||{}; return [r.id,r.createdAt,r.status,r.modelVersion,r.reason,m.epochs,m.examples,m.lossBefore,m.lossAfter,m.accuracyBefore,m.accuracyAfter,m.durationMs,r.evaluationBefore&&r.evaluationBefore.accuracy,r.evaluationAfter&&r.evaluationAfter.accuracy,r.config,r.examplesSnapshot,m,JSON.stringify(r)]; })
    ));
    add('journal-evenements.csv','Journal intégral des opérations conservées',csv(
      ['ordre','id','date_utc','type','auteur','detail','message_lie','enregistrement_complet_json'],
      arr(state.events).map(function (e,i) { return [i+1,e.id,e.createdAt,e.type,e.author,e.detail,e.messageId,JSON.stringify(e)]; })
    ));
    var evaluationRows = [];
    evaluationEntries(state,context).forEach(function (entry) {
      arr(entry.evaluation.results).forEach(function (r,i) { evaluationRows.push([entry.scope,entry.runId,entry.phase,i+1,r.text,r.expected,r.predicted,r.correct,r.score,entry.evaluation.correct,entry.evaluation.total,entry.evaluation.accuracy,JSON.stringify(r)]); });
    });
    add('evaluation.csv','Résultats disponibles des évaluations, cas par cas',csv(
      ['contexte','entrainement_id','phase','cas','texte','intention_attendue','prediction','correct','score','total_correct','nombre_cas','exactitude','cas_complet_json'],evaluationRows
    ));
    var parameters = [], vocabulary = [];
    modelEntries(state).forEach(function (entry) {
      parameters = parameters.concat(parameterRows(entry.model,entry.scope,entry.runId));
      arr(entry.model.vocabulary).forEach(function (feature,index) { vocabulary.push([entry.scope,entry.runId,entry.model.version,index,feature]); });
    });
    add('parametres-modele.csv','Tous les poids et biais disponibles, sans arrondi volontaire',csv(
      ['modele','entrainement_id','version','type','index_parametre','index_classe','classe','index_caracteristique','caracteristique','valeur'],parameters
    ));
    add('vocabulaire-modele.csv','Toutes les caractéristiques des modèles disponibles',csv(
      ['modele','entrainement_id','version','index','caracteristique'],vocabulary
    ));
    add('modeles.json','Modèles actuels, précédents et instantanés exacts',json(modelEntries(state)));
    add('generation-locale.json','Métadonnées de génération, révisions et récupération des modèles ; sans poids préentraînés',json(generation));
    add('contexte-export.json','Contexte technique et mesures réellement fournies',json(context));
    add('regles-et-methodologie.txt','Description des mécanismes et limites d’interprétation',[
      'POI — RÈGLES ET MÉTHODOLOGIE', '',
      'Identité : le nom, le rôle et le nom de l’utilisateur proviennent de l’état enregistré.',
      'Dialogue : les messages portent un rôle utilisateur ou assistant ; « je » et « tu » dépendent du locuteur et du destinataire connus.',
      'Mémoire : les commandes prises en charge enregistrent ou rappellent des paires clé/valeur déclarées par l’utilisateur. Elles ne vérifient pas les faits.',
      'Commandes de mémoire : « Retiens : couleur préférée = bleu » ; « Que sais-tu sur couleur préférée ? ». Les variantes acceptées dépendent des règles de cette version.',
      'Apprentissage : le classifieur softmax ajuste des poids et biais à partir d’exemples étiquetés. Le vocabulaire, les paramètres, la configuration et les seuils effectifs figurent dans modeles.json.',
      'Documents : réponses par sélection de phrases selon la question, définitions explicites, résumé extractif, mesures lexicales et recherche de passages cités. Une pièce jointe ne modifie pas les paramètres du classifieur. Une page non lue ou un résultat OCR incertain ne doit pas être interprété comme une lecture exhaustive. La durée de l’OCR, lorsqu’elle est mesurée, couvre uniquement la reconnaissance du texte et exclut le chargement et la préparation du lecteur.',
      'Réponses programmées : une intention reconnue est traitée par les fonctions programmées ; la formulation de la réponse est préparée. Une intention incertaine peut être refusée.',
      'Génération locale : lorsqu’elle est préparée puis utilisée explicitement, un modèle de langage préentraîné rédige la réponse sur l’appareil à partir d’un contexte borné. Cette opération ne réentraîne pas ses poids. Les messages source generation conservent le modèle, la révision, le SHA-256, la version du moteur, les nombres de jetons, la durée et la raison de fin.',
      'Modèle préentraîné : les poids conservés dans OPFS ou lus depuis un GGUF sélectionné sont exclus de la sauvegarde personnelle et de sa limite de taille. Le mode fichier ne copie pas le modèle dans OPFS ; sélectionner à nouveau le GGUF depuis Fichiers à chaque nouvelle session. generation-locale.json indique les révisions utilisées et comment récupérer puis vérifier le même fichier. Les paramètres du petit classifieur restent intégralement exportés dans modeles.json.',
      'Score : le score n’est pas une preuve de vérité ni de compréhension. Le système possède des seuils de score, de marge et de couverture, exportés avec le modèle.',
      'Évaluation : les résultats fournis sont enregistrés sans exécuter de nouveau test lors de l’export. Les entraînements et leurs jeux d’exemples sont conservés lorsqu’un instantané existe.',
      'Reproductibilité : les paramètres et exemples permettent d’examiner et de reprendre l’état. La durée de calcul peut varier selon l’appareil et la version de son navigateur. Une absence de mesure reste une absence de mesure.',
      '', 'LIMITES', '', LIMITATIONS.map(function (s,i) { return (i+1)+'. '+s; }).join('\n\n'), ''
    ].join('\n'));
    add('LIRE-MOI.txt','Mode d’emploi de l’archive et restauration',[
      'POI — EXPORT DÉTAILLÉ', 'Créé le '+context.createdAt, '',
      '1. Décompressez cette archive ZIP dans Fichiers sur votre iPhone ou sur un ordinateur.',
      '2. Ouvrez rapport-poi-complet.html pour lire les conversations, la mémoire, les exemples, les paramètres et les résultats. Ce rapport est autonome et ne charge aucune ressource externe.',
      '3. Pour restaurer l’application, importez uniquement sauvegarde-poi.json dans POI. L’import remplace l’état actuel : exportez-le d’abord si vous souhaitez le conserver.',
      '4. Les fichiers CSV sont encodés en UTF-8 avec BOM, séparés par des points-virgules et avec toutes les cellules entre guillemets. Un tableur peut arrondir les nombres à l’affichage ; les nombres exacts restent dans les JSON.',
      '5. Par sécurité, les cellules textuelles CSV susceptibles d’être interprétées comme des formules reçoivent une apostrophe initiale. Les textes exacts non modifiés restent dans sauvegarde-poi.json et les objets JSON.',
      '6. Les dates enregistrées sont conservées en UTC ISO 8601. Le rapport affiche aussi les dates dans le fuseau Europe/Paris.',
      '7. Le manifeste donne l’inventaire, les compteurs, la configuration et les empreintes CRC32 des autres fichiers. CRC32 détecte des erreurs de transfert ; ce n’est pas une signature cryptographique ni une preuve d’authenticité.',
      '8. Le rapport ne lance ni entraînement ni test supplémentaire et n’invente aucune mesure. Les résultats absents sont indiqués non fournis.',
      '9. Les originaux des pièces jointes sont dans documents/originaux/ et les textes extraits dans documents/textes/. La sauvegarde JSON les restaure aussi : il n’est pas nécessaire de joindre à nouveau les fichiers. documents.json, documents.csv et pages-documents.csv décrivent les méthodes, les pages lues, les limites et les références.',
      '10. Le modèle génératif préentraîné est conservé séparément dans OPFS ou lu depuis un fichier GGUF sélectionné. Ses poids ne sont pas dans cette archive. L’import JSON ne déclenche aucun téléchargement ; préparez séparément la génération locale sur un nouvel appareil. En mode fichier, sélectionnez le GGUF depuis Fichiers à chaque nouvelle session : il n’est pas copié dans OPFS. generation-locale.json conserve la révision précise, le nom du fichier et son SHA-256 pour récupérer le même modèle, sans garantir une nouvelle réponse identique.',
      '', 'CONFIDENTIALITÉ',
      'Cette archive n’est pas chiffrée. Elle peut contenir des données personnelles ou confidentielles. Partagez-la uniquement après vérification.',
      '', 'CONSERVATION',
      'Seul l’état encore conservé est exporté. Consultez les compteurs de rétention et les limites d’interprétation dans le manifeste et le rapport.',
      'Une suppression volontaire, une réinitialisation ou la perte du stockage local ne peuvent pas être annulées sans une sauvegarde antérieure.',
      '', 'FICHIERS',
      'sauvegarde-poi.json : état restaurable complet.',
      'rapport-poi-complet.html : rapport lisible, autonome et imprimable.',
      'conversation.csv, memoire.csv, exemples-apprentissage.csv : contenus et métadonnées.',
      'entrainements.csv, evaluation.csv : mesures et décisions enregistrées.',
      'journal-evenements.csv : opérations observables conservées.',
      'parametres-modele.csv, vocabulaire-modele.csv, modeles.json : poids, biais, caractéristiques et configurations.',
      'generation-locale.json : provenance des réponses générées et références exactes des modèles préentraînés, sans leurs poids.',
      'contexte-export.json : environnement et diagnostics fournis au moment de l’export.',
      'documents.json, documents.csv, pages-documents.csv : inventaire, extraction complète et références.',
      'documents/originaux/ et documents/textes/ : fichiers joints et texte extrait sans suppression volontaire.',
      'regles-et-methodologie.txt : explication des mécanismes et limites.',
      'manifeste.json : inventaire et informations de vérification.', ''
    ].join('\n'));
    var manifest = {
      format:'poi-detailed-export', formatVersion:3, generator:'POIExport', exporterVersion:VERSION,
      appVersion:context.appVersion || null, coreVersion:context.coreVersion || (core && core.VERSION) || null, stateSchemaVersion:valueOr(state.schemaVersion,null),
      createdAt:context.createdAt, timeZoneForReport:'Europe/Paris', restorableFile:'sauvegarde-poi.json',
      encoding:'UTF-8', csv:{delimiter:';',bom:true,quote:'"',formulaProtection:'Apostrophe initiale sur cellules textuelles à risque ; contenu exact dans JSON.'},
      counts:countsFor(state), retention:state.retention || {}, limits:context.limits || (core && core.LIMITS) || null, identity:state.identity || {},
      currentModel:modelMetadata(state.model), previousModel:modelMetadata(state.previousModel),
      generation:{metadataFile:'generation-locale.json',modelWeightsIncluded:false,modelStorage:generation.modelStorage,models:generation.models,messageCount:generation.messages.length},
      measurements:{selfTestsProvided:!!context.selfTests,evaluationProvided:!!context.evaluation,evaluationAt:context.evaluationAt || null,evaluationModelVersion:valueOr(context.evaluationModelVersion,null),testsRunByExporter:false},
      integrity:{algorithm:'CRC32',cryptographic:false,scope:'Les empreintes ci-dessous couvrent les autres fichiers. Le manifeste lui-même possède un CRC dans les en-têtes ZIP.'},
      privacy:{encrypted:false,containsPersonalData:true,networkRequestsByExporter:0}, limitations:LIMITATIONS,
      files:files.map(function (file) { var bytes=fileBytes(file.content); return {name:file.name,role:file.role,sizeBytes:bytes.length,crc32:crc32(bytes).toString(16).padStart(8,'0')}; }).concat([{name:'manifeste.json',role:'Inventaire et métadonnées de l’export'}])
    };
    add('manifeste.json','Inventaire et métadonnées de l’export',json(manifest));
    return files;
  }
  var crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (var i=0;i<256;i++) {
        var value=i;
        for (var j=0;j<8;j++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        crcTable[i] = value >>> 0;
      }
    }
    var crc = 0xffffffff;
    for (var k=0;k<bytes.length;k++) crc = crcTable[(crc ^ bytes[k]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function dosDate(iso) {
    var date = new Date(iso || '2020-01-01T00:00:00Z');
    if (Number.isNaN(date.getTime())) throw new Error('Date ZIP invalide.');
    var year = Math.max(1980,Math.min(2107,date.getUTCFullYear()));
    return {time:(date.getUTCHours()<<11)|(date.getUTCMinutes()<<5)|Math.floor(date.getUTCSeconds()/2),date:((year-1980)<<9)|((date.getUTCMonth()+1)<<5)|date.getUTCDate()};
  }
  function createZIP(files, createdAt) {
    if (!Array.isArray(files) || files.length > 65535) throw new Error('Nombre de fichiers ZIP non pris en charge.');
    var names = new Set();
    var entries = files.map(function (file) {
      if (!file || typeof file.name !== 'string' || !file.name || file.name.startsWith('/') || file.name.indexOf('\\') !== -1 || file.name.split('/').indexOf('..') !== -1 || names.has(file.name)) throw new Error('Nom de fichier ZIP invalide ou dupliqué.');
      names.add(file.name);
      var name = encoder.encode(file.name);
      if (name.length > 65535) throw new Error('Nom de fichier ZIP trop long.');
      var bytes = file.content instanceof Uint8Array ? file.content : encoder.encode(text(file.content));
      return {name:name,bytes:bytes,crc:crc32(bytes),offset:0};
    });
    var localSize=0, centralSize=0;
    entries.forEach(function (entry) { entry.offset=localSize; localSize+=30+entry.name.length+entry.bytes.length; centralSize+=46+entry.name.length; });
    var total = localSize+centralSize+22;
    if (total > 0xffffffff) throw new Error('Archive trop volumineuse pour ce format ZIP.');
    var output = new Uint8Array(total), view = new DataView(output.buffer), cursor=0, stamp=dosDate(createdAt);
    function u16(number) { view.setUint16(cursor,number,true); cursor+=2; }
    function u32(number) { view.setUint32(cursor,number>>>0,true); cursor+=4; }
    function data(bytes) { output.set(bytes,cursor); cursor+=bytes.length; }
    entries.forEach(function (entry) {
      u32(0x04034b50);u16(20);u16(0x0800);u16(0);u16(stamp.time);u16(stamp.date);u32(entry.crc);u32(entry.bytes.length);u32(entry.bytes.length);u16(entry.name.length);u16(0);data(entry.name);data(entry.bytes);
    });
    entries.forEach(function (entry) {
      u32(0x02014b50);u16(20);u16(20);u16(0x0800);u16(0);u16(stamp.time);u16(stamp.date);u32(entry.crc);u32(entry.bytes.length);u32(entry.bytes.length);u16(entry.name.length);u16(0);u16(0);u16(0);u16(0);u32(0);u32(entry.offset);data(entry.name);
    });
    u32(0x06054b50);u16(0);u16(0);u16(entries.length);u16(entries.length);u32(centralSize);u32(localSize);u16(0);
    return output;
  }
  function produce(state, rawContext) {
    var context=getContext(rawContext), files=createFiles(state,context);
    var bytes=createZIP(files,context.createdAt);
    var timestamp=context.createdAt.replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
    return {filename:'poi-export-complet-'+timestamp+'.zip',bytes:bytes,files:files.map(function (file) { return {name:file.name,size:fileBytes(file.content).length}; }),counts:countsFor(state),createdAt:context.createdAt};
  }
  return {VERSION:VERSION,produce:produce,generateReport:generateReport,createFiles:createFiles,createZIP:createZIP,crc32:crc32};
});
