(function (root, factory) {
  'use strict';
  function documentsProvider() {
    if (root && root.POIDocuments) return root.POIDocuments;
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      try { return require('./documents.js'); }
      catch (error) {
        if (error.code === 'MODULE_NOT_FOUND' && /Cannot find module ['"]\.\/documents\.js['"]/.test(error.message)) return null;
        throw error;
      }
    }
    return null;
  }
  if (typeof module === 'object' && module.exports) module.exports = factory(documentsProvider);
  else root.POICore = factory(documentsProvider);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (documentsProvider) {
  'use strict';

  var VERSION = '1.3.0';
  var DEFAULT_EPOCHS = 400, MAX_EPOCHS = 800;
  var LIMITS = Object.freeze({ message: 2000, assistantMessage: 16000, example: 500, examples: 400, facts: 100,
    messages: 2000, events: 5000, trainingRuns: 100, features: 384, importBytes: 25 * 1024 * 1024 });
  var INTENTS = Object.freeze([
    { id: 'identity', label: 'Identité', description: 'Demander le nom de l’agent.' },
    { id: 'role', label: 'Rôle', description: 'Demander sa mission pédagogique.' },
    { id: 'capabilities', label: 'Capacités', description: 'Demander les fonctions réellement disponibles.' },
    { id: 'remember', label: 'Mémoriser', description: 'Demander comment enregistrer un fait déclaré.' },
    { id: 'recall', label: 'Rappeler', description: 'Demander comment retrouver un fait déclaré.' },
    { id: 'greeting', label: 'Salutation', description: 'Reconnaître une salutation simple.' }
  ]);
  var CLASSES = INTENTS.map(function (item) { return item.id; });
  var SEED_TEXTS = {
    identity: ['Comment t’appelles-tu ?', 'Quel est ton nom ?', 'Dis-moi ton prénom', 'Présente-toi', 'Comment dois-je t’appeler ?', 'Je veux connaître ton nom', 'Quel nom portes-tu ?', 'Donne-moi ton identité'],
    role: ['Quel est ton rôle ?', 'Quelle est ta mission ?', 'À quoi sers-tu ?', 'Explique ton rôle pédagogique', 'Pourquoi existes-tu dans cet atelier ?', 'Quelle est ton utilité ?', 'Explique ta mission', 'À quoi peux-tu être utile ?'],
    capabilities: ['Que sais-tu faire ?', 'Quelles sont tes capacités ?', 'Quels outils as-tu ?', 'Liste tes fonctions disponibles', 'Quelles actions peux-tu effectuer ?', 'Qu’es-tu capable de faire ?', 'As-tu accès à Internet ?', 'Peux-tu expliquer tes possibilités ?'],
    remember: ['Retiens cette information', 'Mémorise un fait', 'Enregistre cette donnée', 'Ajoute un renseignement à la mémoire', 'Je souhaite enregistrer une information', 'Peux-tu retenir un détail ?', 'Conserve ce renseignement', 'Je veux que tu retiennes une donnée'],
    recall: ['Rappelle-moi une information', 'Que sais-tu sur ma couleur ?', 'Retrouve ce fait', 'Consulte les informations mémorisées', 'Je souhaite retrouver un renseignement', 'Qu’as-tu retenu ?', 'Lis un fait de ta mémoire', 'Montre les données enregistrées'],
    greeting: ['Bonjour', 'Salut', 'Bonsoir', 'Coucou', 'Bonjour POI', 'Salut à toi', 'Je te salue', 'Coucou POI']
  };
  var SEED_EXAMPLES = [];
  CLASSES.forEach(function (intent) {
    SEED_TEXTS[intent].forEach(function (value, index) {
      SEED_EXAMPLES.push(Object.freeze({ id: 'starter-' + intent + '-' + (index + 1), text: value, intent: intent, origin: 'starter' }));
    });
  });
  Object.freeze(SEED_EXAMPLES);
  // Fixed small evaluation set. It is never added to the training examples.
  var HELDOUT = Object.freeze([
    { text: 'Puis-je savoir comment tu t’appelles ?', expected: 'identity' },
    { text: 'J’aimerais connaître ton nom.', expected: 'identity' },
    { text: 'Indique-moi ton prénom.', expected: 'identity' },
    { text: 'Quel rôle joues-tu dans cet atelier ?', expected: 'role' },
    { text: 'Explique la mission qui t’est confiée.', expected: 'role' },
    { text: 'En quoi es-tu utile ?', expected: 'role' },
    { text: 'Liste les actions que tu es capable de faire.', expected: 'capabilities' },
    { text: 'De quels outils disposes-tu ?', expected: 'capabilities' },
    { text: 'Quelles fonctions sont disponibles ici ?', expected: 'capabilities' },
    { text: 'Ajoute cette information à ta mémoire.', expected: 'remember' },
    { text: 'Peux-tu enregistrer un renseignement ?', expected: 'remember' },
    { text: 'J’aimerais que tu retiennes une nouvelle donnée.', expected: 'remember' },
    { text: 'Peux-tu retrouver une information mémorisée ?', expected: 'recall' },
    { text: 'Rappelle les faits enregistrés.', expected: 'recall' },
    { text: 'Montre-moi les données que tu as retenues.', expected: 'recall' },
    { text: 'Eh bien, bonjour !', expected: 'greeting' },
    { text: 'Un petit coucou.', expected: 'greeting' },
    { text: 'Bonsoir à toi, POI !', expected: 'greeting' }
  ]);
  var STOP = Object.create(null);
  ('a au aux avec ce ces cette cet de des du en et est es etre je tu il elle nous vous ils elles ' +
   'le la les l un une d j t m s n y qui que quoi quel quelle quels quelles qu comment ' +
   'ton ta tes mon ma mes me moi toi te se son sa ses pour par sur dans peux peut puis ' +
   'peux tu as ai avons suis sont ici aimerais souhaite veux bien merci').split(' ').forEach(function (word) { STOP[word] = true; });
  var sequence = 0;

  function now() { return new Date().toISOString(); }
  function id(prefix) { sequence += 1; return prefix + '-' + Date.now().toString(36) + '-' + sequence.toString(36); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function normalized(value) {
    return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[’']/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  }
  function contentWords(value) {
    return normalized(value).split(' ').filter(function (word) { return word.length > 1 && word.length <= 40 && !STOP[word]; });
  }
  function featureNames(value) {
    var words = contentWords(value), found = Object.create(null), output = [];
    words.forEach(function (word, index) {
      var feature = 'w:' + word;
      if (!found[feature]) { output.push(feature); found[feature] = true; }
      if (index) {
        feature = 'b:' + words[index - 1] + '|' + word;
        if (!found[feature]) { output.push(feature); found[feature] = true; }
      }
    });
    return output;
  }
  function fail(message) { throw new Error(message); }
  function textValue(value, name, max, allowEmpty) {
    if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) fail(name + ' invalide.');
    return value.trim();
  }
  function finite(value, name, min, max) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(name + ' invalide.');
    return value;
  }
  function integer(value, name, min, max) {
    finite(value, name, min, max);
    if (Math.floor(value) !== value) fail(name + ' doit être un entier.');
    return value;
  }
  function dateValue(value, name) {
    textValue(value, name, 40, false);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)) fail(name + ' invalide.');
    return value;
  }
  function plain(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(name + ' doit être un objet.');
    var proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) fail(name + ' possède un prototype non autorisé.');
    return value;
  }
  function keysOnly(value, allowed, name) {
    plain(value, name);
    Object.keys(value).forEach(function (key) {
      if (allowed.indexOf(key) < 0) fail(name + ' contient un champ non reconnu : ' + key + '.');
    });
  }
  function list(value, name, max) {
    if (!Array.isArray(value) || value.length > max) fail(name + ' dépasse la limite autorisée.');
    return value;
  }
  function validIntent(value) {
    if (CLASSES.indexOf(value) < 0) fail('Catégorie inconnue.');
    return value;
  }
  function ensureUnique(items, field, name) {
    var seen = Object.create(null);
    items.forEach(function (item) {
      var key = item[field];
      if (seen[key]) fail(name + ' contient un doublon.');
      seen[key] = true;
    });
    return items;
  }

  function createState() {
    var time = now();
    return { schemaVersion: 1, meta: { createdAt: time, updatedAt: time },
      identity: { name: 'POI', role: 'assistante pédagogique', userName: '' },
      facts: [], documents: [], examples: clone(SEED_EXAMPLES), model: null, previousModel: null,
      messages: [], events: [], trainingRuns: [],
      retention: { messagesDropped: 0, eventsDropped: 0, trainingRunsDropped: 0 } };
  }
  function touch(state) { if (!state.meta) state.meta = { createdAt: now(), updatedAt: now() }; state.meta.updatedAt = now(); }
  function appendBounded(state, field, item, maximum) {
    state[field].push(item);
    if (state[field].length > maximum) {
      var removed = state[field].length - maximum;
      state[field].splice(0, removed);
      if (!state.retention) state.retention = { messagesDropped: 0, eventsDropped: 0, trainingRunsDropped: 0 };
      state.retention[field + 'Dropped'] = (state.retention[field + 'Dropped'] || 0) + removed;
    }
  }
  function recordEvent(state, type, author, detail, messageId) {
    var entry = { id: id('event'), type: type, author: author, detail: detail, createdAt: now() };
    if (messageId) entry.messageId = messageId;
    appendBounded(state, 'events', entry, LIMITS.events);
    touch(state);
    return entry;
  }
  function referent(pronoun, speaker, recipient) {
    if (pronoun === 'je') return speaker == null ? null : speaker;
    if (pronoun === 'tu') return recipient == null ? null : recipient;
    return null;
  }
  function answer(text, source, intent, score, explanation) {
    return { text: text, source: source, intent: intent || null, score: score == null ? null : score, explanation: explanation };
  }
  function documentModule() {
    var module = documentsProvider();
    if (!module || typeof module.validateDocuments !== 'function' || typeof module.answer !== 'function') fail('Le module de documents n’est pas disponible. Rechargez l’application avant d’utiliser les pièces jointes.');
    return module;
  }
  function validateDocumentList(value) {
    if (!Array.isArray(value)) fail('La liste des documents est invalide.');
    // Empty and legacy states must remain readable without the optional module.
    if (!value.length) return [];
    return documentModule().validateDocuments(value);
  }
  function validateDocumentIds(value) {
    var ids = list(value, 'Documents sélectionnés', 6).map(function (item) { return textValue(item, 'Identifiant de document', 100, false); });
    if (new Set(ids).size !== ids.length) fail('La sélection de documents contient un doublon.');
    return ids;
  }
  function validateCitations(value, documentIds, documents) {
    return list(value, 'Citations documentaires', 24).map(function (citation) {
      keysOnly(citation, ['documentId', 'name', 'page', 'excerpt'], 'Citation');
      var item = { documentId: textValue(citation.documentId, 'Document cité', 100, false),
        name: textValue(citation.name, 'Nom du document cité', 180, false),
        page: integer(citation.page, 'Page citée', 1, 1000000) };
      textValue(citation.excerpt, 'Extrait cité', 1200, false);
      // Keep the exact quote, including intentional leading/trailing whitespace.
      item.excerpt = citation.excerpt;
      if (!documentIds || documentIds.indexOf(item.documentId) < 0) fail('Une citation doit appartenir aux documents sélectionnés pour ce message.');
      if (documents) {
        var document = documents.filter(function (entry) { return entry.id === item.documentId; })[0];
        var page = document && document.pages.filter(function (entry) { return entry.number === item.page; })[0];
        if (!document || document.name !== item.name || !page || page.text.indexOf(item.excerpt) < 0) fail('La citation ne correspond pas au texte du document sélectionné.');
      }
      return item;
    });
  }
  function validateGeneration(value) {
    keysOnly(value, ['runtime', 'runtimeVersion', 'modelId', 'modelRevision', 'modelFile', 'modelSha256', 'local',
      'inputTokens', 'outputTokens', 'contextCharacters', 'durationMs', 'finishReason', 'citationScope'], 'Provenance de génération');
    if (value.runtime !== 'wllama' || value.local !== true || value.citationScope !== 'provided-context') fail('Provenance de génération locale invalide.');
    if (!/^[a-f0-9]{40}$/.test(value.modelRevision) || !/^[a-f0-9]{64}$/.test(value.modelSha256)) fail('Révision ou empreinte du modèle génératif invalide.');
    if (['stop', 'length'].indexOf(value.finishReason) < 0) fail('Fin de génération invalide.');
    return { runtime: 'wllama', runtimeVersion: textValue(value.runtimeVersion, 'Version du moteur génératif', 40, false),
      modelId: textValue(value.modelId, 'Modèle génératif', 180, false), modelRevision: value.modelRevision,
      modelFile: textValue(value.modelFile, 'Fichier du modèle génératif', 180, false), modelSha256: value.modelSha256, local: true,
      inputTokens: integer(value.inputTokens, 'Jetons du contexte', 1, 100000), outputTokens: integer(value.outputTokens, 'Jetons générés', 0, 16000),
      contextCharacters: integer(value.contextCharacters, 'Caractères du contexte fourni', 0, 32000),
      durationMs: finite(value.durationMs, 'Durée de génération', 0, 86400000), finishReason: value.finishReason, citationScope: 'provided-context' };
  }
  function selectedDocuments(state, options) {
    if (options == null) return null;
    keysOnly(options, ['documentIds'], 'Options de conversation');
    if (options.documentIds == null) return null;
    var ids = validateDocumentIds(options.documentIds);
    if (!ids.length) return null;
    var module = documentModule(), documents = module.validateDocuments(state.documents || []);
    if (ids.some(function (documentId) { return !documents.some(function (document) { return document.id === documentId; }); })) fail('Un document sélectionné est absent. Actualisez la sélection des pièces jointes.');
    return { module: module, documents: documents, ids: ids };
  }
  function answerForIntent(state, intent, source, score) {
    var name = state.identity.name;
    var values = {
      identity: 'Je m’appelle ' + name + '.',
      role: 'Mon rôle est : ' + state.identity.role + '. Je suis un atelier pour observer des règles, une mémoire et un petit apprentissage local.',
      capabilities: 'Je peux répondre à des questions simples à partir des faits que vous avez enregistrés et des documents que vous importez puis sélectionnez. Je peux y retrouver une information ou une définition explicitement présente, proposer un résumé par extraits et des mesures lexicales, et citer les passages utilisés. Le générateur local optionnel, lorsqu’il est préparé, peut rédiger une réponse à partir du contexte fourni ; ses affirmations restent à vérifier. Je peux aussi me présenter, distinguer les auteurs des messages, mémoriser vos déclarations explicites et entraîner un petit classifieur de six intentions. Je n’accède ni au Web pour répondre, ni à vos autres applications, ni à vos fichiers sans import volontaire.',
      remember: 'Pour enregistrer un fait, écrivez « Retiens : couleur préférée = bleu ». Vous pouvez aussi écrire « Retiens que ma couleur préférée est bleu ». Je mémorise cette déclaration sans en vérifier la vérité.',
      recall: 'Vous pouvez demander « Quelle est ma couleur préférée ? », « Que sais-tu sur moi ? » ou « Que sais-tu sur [clé] ? ». Je réponds à partir de vos déclarations enregistrées et je demande une précision si plusieurs faits correspondent.',
      greeting: 'Bonjour' + (state.identity.userName ? ' ' + state.identity.userName : '') + ' ! Je suis ' + name + '. Que souhaitez-vous essayer dans cet atelier ?'
    };
    return answer(values[intent], source, intent, score, source === 'model'
      ? 'Le classifieur entraîné a proposé cette intention ; la réponse vient d’un gabarit programmé. Son score compare les six catégories, il ne mesure pas la vérité.'
      : 'Cette formulation est couverte par une règle programmée ; aucun entraînement n’est nécessaire.');
  }
  function parseMemoryCommand(text) {
    var match = text.match(/^\s*(?:retiens|mémorise|memorise)\s*:\s*([^=\n]{1,80})\s*=\s*([^\n]{1,500})\s*$/i);
    if (match) return { key: match[1].trim(), value: match[2].trim() };
    match = text.match(/^\s*retiens\s+que\s+ma\s+([^\n=.!?]{1,80}?)\s+est\s+([^\n]{1,500})\s*$/i);
    if (match && !/[?？]/.test(text)) return { key: match[1].trim(), value: match[2].trim().replace(/\.$/, '') };
    return null;
  }
  function parseRecallCommand(text) {
    var match = text.match(/^\s*que\s+sais[-\s]tu\s+(?:sur|de)\s+(.{1,85}?)\s*\?*\s*$/i);
    return match ? match[1].trim().replace(/[?\s]+$/, '') : null;
  }
  // Deliberately limited aliases: remove grammatical wrappers, never another
  // person's name or a meaningful qualifier such as "voiture" or "chien".
  function memoryKey(value) {
    var words = normalized(value).replace(/^(?:ma|mon|mes|le|la|les|une?|l) /, '').replace(/ (?:de|a) moi$/, '').split(' ');
    var aliases = { couleurs: 'couleur', preferee: 'prefere', preferees: 'prefere', preferes: 'prefere',
      favorite: 'prefere', favorites: 'prefere', favori: 'prefere', favoris: 'prefere',
      villes: 'ville', adresses: 'adresse', noms: 'nom', prenoms: 'prenom',
      professions: 'metier', profession: 'metier', metiers: 'metier', domiciles: 'domicile',
      residences: 'residence', loisirs: 'loisir', animaux: 'animal', livres: 'livre' };
    return words.filter(function (word) { return word && !/^(?:de|du|des|le|la|les|l|d)$/.test(word); })
      .map(function (word) { return aliases[word] || word; }).join(' ');
  }
  function documentSubject(simple) {
    return /\b(?:dans|selon|d apres) (?:le |la |les |ce |cet |cette |ces |mon |ma |mes )?(?:document|livre|roman|texte|ouvrage|fichier|pdf|chapitre|passage|piece jointe)\b/.test(simple) ||
      /\b(?:du|de ce|de cet|de cette|de la|des) (?:document|livre|roman|texte|ouvrage|fichier|pdf|chapitre|passage|piece jointe)\b/.test(simple) ||
      /^que sais tu sur (?:le |la |les |ce |cet |cette )?(?:document|livre|roman|texte|ouvrage|fichier|pdf)\b/.test(simple);
  }
  function personalRequest(simple, followUp) {
    if (documentSubject(simple)) return null;
    if (/^(?:que sais tu sur moi|qu as tu (?:retenu|memorise|enregistre) (?:de|sur) moi|que sais tu de moi)$/.test(simple)) return { kind: 'summary' };
    if (/^(?:(?:est ce que )?tu sais |sais tu )?comment (?:est ce que )?je m appelle$/.test(simple) || /^(?:quel est mon nom|quel est mon prenom|mon nom|mon prenom)$/.test(simple)) return { kind: 'name', key: 'nom' };
    if (/^(?:ou (?:est ce que )?(?:j habite|je vis)|(?:sais tu|tu sais|tu te souviens|te souviens tu|peux tu me rappeler) ou (?:j habite|je vis))$/.test(simple)) return { kind: 'residence', key: 'lieu de résidence' };
    var match = simple.match(/^(?:quels?|quelles?) (?:est|sont) (?:ma|mon|mes) (.+)$/) ||
      simple.match(/^(?:(?:est ce que )?tu te souviens de|te souviens tu de|rappelle(?: moi)?|(?:peux tu )?(?:me )?rappeler|(?:peux tu )?me redire) (?:ma|mon|mes) (.+)$/) ||
      simple.match(/^que sais tu sur (?:ma|mon|mes) (.+)$/) || simple.match(/^et (?:ma|mon|mes) (.+)$/);
    if (match && match[1].length <= 85) return { kind: /^(?:nom|prenom|nom complet)$/.test(memoryKey(match[1])) ? 'name' : 'key', key: match[1], personal: true };
    if (/^quelle (?:est la )?couleur (?:est ce que je prefere|je prefere|prefere je)$/.test(simple)) return { kind: 'key', key: 'couleur préférée', personal: true };
    if (followUp) {
      match = simple.match(/^et (?:le|la|les|l) (.+)$/);
      if (match && match[1].length <= 85) return { kind: 'key', key: match[1], personal: true };
    }
    return null;
  }
  function memorySummary(state) {
    var lines = [];
    if (state.identity.userName) lines.push('Nom renseigné dans vos réglages : ' + state.identity.userName + '.');
    if (state.facts.length) {
      lines.push('Vous avez enregistré ' + state.facts.length + ' déclaration' + (state.facts.length > 1 ? 's' : '') + ' :');
      state.facts.slice(0, 12).forEach(function (fact) { lines.push('• ' + fact.key + ' : ' + fact.value); });
      if (state.facts.length > 12) lines.push('Les ' + (state.facts.length - 12) + ' autres déclarations sont disponibles dans Mémoire. Vous pouvez me demander une clé précise.');
      lines.push('Source : vos déclarations explicites. Je conserve les clés telles que vous les avez données ; une information concernant une autre personne reste attribuée à cette personne.');
    }
    if (!lines.length) lines.push('Je n’ai encore aucune information personnelle enregistrée sur vous. Vous pouvez renseigner votre nom dans les réglages ou ajouter un fait dans Mémoire avec une clé et une valeur.');
    return answer(lines.join('\n'), lines.length === 1 && !state.identity.userName && !state.facts.length ? 'unknown' : 'memory', 'recall', null,
      'Inventaire du nom utilisateur renseigné et des faits explicitement déclarés par l’utilisateur ; aucune inférence à partir des documents ou des messages ordinaires.');
  }
  function memoryAnswer(state, request) {
    if (request.kind === 'summary') return memorySummary(state);
    var wanted = memoryKey(request.key), exact = [], partial = [], names = /^(?:nom|prenom|nom complet|identite)$/;
    var residences = /^(?:ville|adresse|domicile|residence|lieu residence|ville residence|ville habitation|lieu vie|habitation)$/;
    state.facts.forEach(function (fact) {
      var candidate = memoryKey(fact.key);
      if (candidate === wanted || (request.kind === 'name' && names.test(candidate)) || (request.kind === 'residence' && residences.test(candidate))) exact.push({ key: fact.key, value: fact.value, from: 'fact' });
      else if (request.kind === 'key' && wanted && wanted.split(' ').every(function (word) { return candidate.split(' ').indexOf(word) >= 0; })) partial.push(fact);
    });
    if (request.kind === 'name' && state.identity.userName) exact.push({ key: 'nom dans les réglages', value: state.identity.userName, from: 'settings' });
    // Two equivalent labels with different values require clarification; they
    // must not be silently merged into a new personal fact.
    var values = Array.from(new Set(exact.map(function (fact) { return fact.value; })));
    if (exact.length && values.length === 1) {
      var found = exact[0];
      return answer((found.from === 'settings' ? 'Votre nom renseigné est ' + found.value + '. Source : vos réglages.' :
        'Vous m’avez indiqué : « ' + found.key + ' = ' + found.value + ' ». Source : votre déclaration enregistrée.'),
      'memory', 'recall', null, 'Rappel d’une information fournie par l’utilisateur. La valeur est conservée avec sa provenance et n’est pas une déduction du modèle.');
    }
    if (exact.length > 1 || partial.length) {
      var candidates = exact.length ? exact : partial;
      return answer('Pour « ' + request.key + ' », pouvez-vous préciser la clé souhaitée ? Je trouve ' + candidates.slice(0, 8).map(function (fact) { return '« ' + fact.key + ' »'; }).join(', ') +
        (candidates.length > 8 ? ' et ' + (candidates.length - 8) + ' autres clés' : '') + '. Je préfère vous demander avant de choisir une valeur.',
      'memory', 'recall', null, 'Plusieurs valeurs ou une clé seulement partielle correspondent. Aucune valeur ni attribution personnelle n’a été devinée.');
    }
    return answer('Je n’ai aucune information enregistrée pour « ' + request.key + ' ». ' + (request.kind === 'name' ? 'Vous pouvez renseigner votre nom dans les réglages ou dans Mémoire.' :
      'Vous pouvez l’ajouter dans Mémoire, ou écrire « Retiens : ' + request.key + ' = [votre valeur] » en remplaçant les crochets.'),
    'unknown', 'recall', null, 'Aucune déclaration correspondante n’est enregistrée ; les documents et les propos d’autres personnes ne servent pas à inventer une donnée personnelle.');
  }
  function learnedStateAnswer(state) {
    var lines = [], active = state.model;
    if (active) {
      lines.push('Le modèle actif de classement (' + active.version + ') a été entraîné sur ' + active.examplesUsed + ' formulations pendant ' + active.config.epochs + ' itérations.');
      lines.push('Il classe les demandes dans ces six catégories : ' + INTENTS.filter(function (intent) { return active.classes.indexOf(intent.id) >= 0; }).map(function (intent) { return intent.label; }).join(', ') + '.');
      var runs = state.trainingRuns.filter(function (run) { return run.modelVersion === active.version || (run.parametersSnapshot && run.parametersSnapshot.version === active.version); });
      var snapshot = runs.slice().reverse().filter(function (run) { return Array.isArray(run.examplesSnapshot); })[0];
      if (snapshot) {
        var examples = snapshot.examplesSnapshot.filter(function (example) { return example.origin === 'user'; });
        if (!examples.length) examples = snapshot.examplesSnapshot;
        lines.push('Exemples conservés de cet entraînement : ' + examples.slice(0, 3).map(function (example) {
          return '« ' + example.text + ' » → ' + INTENTS.filter(function (intent) { return intent.id === example.intent; })[0].label;
        }).join(' ; ') + '.');
      } else lines.push('Le détail des formulations de cette version n’est pas conservé dans l’historique ; je ne peux pas le reconstituer à partir des seuls paramètres.');
    } else lines.push('Aucun classifieur entraîné n’est actif. ' + state.examples.length + ' formulations sont préparées dans Apprendre ; elles ne constituent pas encore une version adoptée.');
    if (active) lines.push('Le jeu actuellement préparé contient ' + state.examples.length + ' formulations ; il peut différer de celui du modèle actif. Une nouvelle séance ne change mes réponses qu’après adoption.');
    lines.push('Séparément, la mémoire contient ' + state.facts.length + ' déclaration' + (state.facts.length > 1 ? 's' : '') + ' et ' + (state.documents || []).length + ' document' + ((state.documents || []).length > 1 ? 's sont importés.' : ' est importé.'));
    lines.push('Mémoriser un fait ou lire un document ne réentraîne pas ce modèle : les faits sont rappelés depuis Mémoire et les réponses documentaires s’appuient sur les passages extraits.');
    lines.push('Le générateur local optionnel est un modèle préentraîné distinct. Lui fournir vos données comme contexte ne modifie pas ses paramètres et ne constitue pas un nouvel entraînement.');
    return answer(lines.join('\n'), 'rule', null, null, 'Description de l’état réellement présent : modèle actif, éventuel instantané d’entraînement, mémoire et pièces jointes. Aucun apprentissage général ou raisonnement intérieur n’est supposé.');
  }
  function unsupportedAnswer(state, text, score, reason) {
    var simple = normalized(text), message;
    if (/\b(?:meteo|temps fait|actualites?|aujourd hui|cours de la bourse)\b/.test(simple)) message = 'Je n’ai pas accès aux informations en direct pour répondre à cette demande. Si vous importez un bulletin ou un article, je peux en chercher les informations et citer son texte.';
    else if (documentSubject(simple) || /\b(?:ce livre|ce document|ce roman|ce fichier)\b/.test(simple)) message = 'Pour répondre sur ce document, importez-le puis sélectionnez-le dans la conversation. Indiquez ensuite le passage, le personnage ou le sujet à rechercher ; je pourrai relier la réponse au texte disponible.';
    else if (/^(?:qu est ce que|definis|explique(?: moi)?|pourquoi|comment fonctionne)\b/.test(simple)) message = 'Je n’ai pas de source enregistrée qui permette d’expliquer ce sujet. Vous pouvez importer un texte qui le traite et me demander une explication de ses passages. Pour mon propre fonctionnement, demandez mes capacités, ma mémoire ou ce que le modèle a appris.';
    else if (/^(?:ecris|redige|compose|invente|cree)(?: moi)?\b/.test(simple)) message = 'Pour rédiger cette demande, préparez le générateur local optionnel dans la conversation. Vous pouvez lui fournir un document sélectionné ou des souvenirs enregistrés comme contexte. Les réponses rédigées restent à vérifier.';
    else message = 'Pouvez-vous préciser l’information que vous cherchez ? Pour un souvenir, indiquez la clé enregistrée ; pour un texte, importez et sélectionnez le document puis posez une question sur son contenu. Je peux aussi expliquer mon identité, mes capacités et l’état de mon apprentissage.';
    return answer(message, 'unknown', null, score, reason || 'La demande ne correspond pas aux réponses disponibles ; une précision ou une source est nécessaire, sans inventer de contenu.');
  }
  function processMessage(state, text, messageId, documentContext) {
    var simple = normalized(text), memory = parseMemoryCommand(text), key, existing, time;
    if (memory) {
      key = normalized(memory.key);
      if (!key || !memory.value) return answer('La clé et la valeur doivent être renseignées. Exemple : « Retiens : couleur préférée = bleu ».', 'rule', 'remember', null, 'Commande incomplète ; aucun fait enregistré.');
      existing = state.facts.filter(function (fact) { return normalized(fact.key) === key; })[0];
      if (!existing && state.facts.length >= LIMITS.facts) return answer('La mémoire contient déjà ' + LIMITS.facts + ' faits. Exportez vos données puis libérez une place dans la mémoire avant d’ajouter un fait.', 'rule', 'remember', null, 'Limite de mémoire atteinte ; aucun fait existant n’a été supprimé.');
      var wasExisting = Boolean(existing);
      time = now();
      if (existing) { existing.value = memory.value; existing.updatedAt = time; existing.author = 'user'; }
      else { existing = { id: id('fact'), key: memory.key, value: memory.value, author: 'user', createdAt: time, updatedAt: time }; state.facts.push(existing); }
      recordEvent(state, 'fact_' + (wasExisting ? 'updated' : 'saved'), 'user', 'Déclaration explicite : ' + existing.key + ' = ' + existing.value, messageId);
      return answer('J’ai enregistré votre déclaration : « ' + existing.key + ' = ' + existing.value + ' ». Elle reste attribuée à vous.', 'memory', 'remember', null, 'Mémoire d’un fait déclaré par l’utilisateur ; les paramètres du modèle ne changent pas.');
    }
    var previousAssistant = state.messages[state.messages.length - 2];
    var previousUser = state.messages[state.messages.length - 3];
    var followsMemory = previousAssistant && previousAssistant.role === 'assistant' && previousAssistant.intent === 'recall' &&
      previousUser && previousUser.role === 'user' && personalRequest(normalized(previousUser.text), false);
    var request = personalRequest(simple, Boolean(followsMemory));
    if (request) return memoryAnswer(state, request);
    var recall = parseRecallCommand(text);
    if (recall !== null && !documentSubject(simple)) {
      var recallKey = memoryKey(recall);
      var hasKey = state.facts.some(function (fact) { return memoryKey(fact.key) === recallKey; });
      if (!documentContext || hasKey) return memoryAnswer(state, { kind: 'key', key: recall });
    }
    if (/^(?:qu as tu appris|qu est ce que tu as appris|que sais tu maintenant|ou en est ton apprentissage|quel est ton etat d apprentissage)$/.test(simple)) return learnedStateAnswer(state);
    if ((!documentSubject(simple) && /\b(?:six|6) (?:intentions|categories|types de demandes)\b/.test(simple)) ||
        /^(?:quelles (?:sont tes|sont les|sont mes) intentions|quelles intentions (?:comprends tu|reconnais tu)|explique(?: moi)? les intentions)$/.test(simple)) {
      return answer('Une intention désigne le type de demande à reconnaître. Mes six catégories sont :\n' +
        INTENTS.map(function (item, index) { return (index + 1) + '. ' + item.label + ' : ' + item.description; }).join('\n') +
        '\nDans Apprendre, choisissez la catégorie attendue et écrivez une formulation par ligne. Ces six catégories ne couvrent pas toutes les conversations possibles.',
      'rule', null, null, 'Présentation programmée des six catégories réelles du classifieur ; aucun entraînement ni ajout d’exemple.');
    }
    if (!documentContext && /^\s*[^=\n]{1,100}\s*=\s*[^=\n]{1,100}\s*$/.test(text)) {
      return answer('Écrire une équivalence comme « Yo=Bonjour » dans la conversation ne m’enseigne pas le mot « Yo ». Ouvrez Apprendre, saisissez « Yo » seul, choisissez la catégorie Salutation, puis entraînez et adoptez une version. Une ligne doit contenir une seule formulation, sans signe « = ».',
        'rule', null, null, 'Le signe « = » est traité comme de la ponctuation, pas comme une instruction d’apprentissage. Les exemples et les paramètres sont inchangés.');
    }
    if (/^(qui suis je|qui est je|qui designe je|je designe qui)$/.test(simple)) {
      return answer('Dans votre message, « je » vous désigne' + (state.identity.userName ? ', ' + state.identity.userName : '') + '. Dans une réponse de l’assistante, « je » désigne ' + state.identity.name + '.', 'rule', null, null, 'Le locuteur et le destinataire sont fournis par la structure du dialogue. Cette règle ne résout pas les citations libres.');
    }
    if (/^(qui est tu|qui designe tu|tu designe qui|explique je et tu|a qui renvoient je et tu)$/.test(simple)) {
      return answer('Quand vous m’écrivez, « je » vous désigne et « tu » me désigne. Quand je vous réponds, ces rôles s’inversent.', 'rule', null, null, 'Résolution de pronoms à partir des rôles connus ; aucune attribution implicite dans une citation n’est supposée.');
    }
    if (/^(qui es tu|comment t appelles tu|quel est ton nom|ton nom|presente toi|peux tu te presenter|donne moi ton identite)$/.test(simple)) return answerForIntent(state, 'identity', 'rule');
    if (/^(quel est ton role|quelle est ta mission|a quoi sers tu|que fais tu|ton role|ta mission)$/.test(simple)) return answerForIntent(state, 'role', 'rule');
    if (/^(que sais tu faire|que peux tu faire|quelles sont tes capacites|quels outils as tu|as tu acces a internet|peux tu acceder a internet)$/.test(simple)) return answerForIntent(state, 'capabilities', 'rule');
    if (/^(bonjour|salut|bonsoir|coucou)( poi)?$/.test(simple)) return answerForIntent(state, 'greeting', 'rule');
    if (/^(retiens|memorise|enregistre)( |$)/.test(simple)) return answerForIntent(state, 'remember', 'rule');
    if (/^(que sais tu|qu as tu retenu|consulte ta memoire|montre ta memoire)$/.test(simple)) return answerForIntent(state, 'recall', 'rule');
    if (documentContext) {
      var documentReply = documentContext.module.answer(documentContext.documents, text, documentContext.ids,
        { messages: state.messages, identity: state.identity, facts: state.facts });
      if (documentReply) {
        var documentAnswer = answer(textValue(documentReply.text, 'Réponse documentaire', LIMITS.assistantMessage, false),
          'document', null, null, textValue(documentReply.explanation || 'Réponse extraite des documents sélectionnés.', 'Explication documentaire', 4000, true));
        if (documentReply.citations !== undefined) documentAnswer.citations = validateCitations(documentReply.citations, documentContext.ids, documentContext.documents);
        return documentAnswer;
      }
    }
    if (state.model) {
      var proposed = predict(state.model, text);
      if (proposed.accepted) return answerForIntent(state, proposed.intent, 'model', proposed.score);
      return unsupportedAnswer(state, text, proposed.score, proposed.reason + ' Le score compare seulement les six intentions du classifieur.');
    }
    return unsupportedAnswer(state, text, null);
  }
  function handleMessage(state, text, options) {
    text = textValue(text, 'Message', LIMITS.message, false);
    var documentContext = selectedDocuments(state, options);
    // Stage only mutable collections; document payload strings and models stay shared.
    // Reading a document or exceeding the complete backup budget cannot leave half a turn.
    var candidate = mutationCandidate(state, { messages: state.messages.slice(), facts: state.facts.map(function (fact) { return Object.assign({}, fact); }) });
    var userMessage = { id: id('message'), role: 'user', speakerName: candidate.identity.userName || 'Utilisateur', text: text, createdAt: now() };
    if (documentContext) userMessage.documentIds = documentContext.ids.slice();
    appendBounded(candidate, 'messages', userMessage, LIMITS.messages);
    var response = processMessage(candidate, text, userMessage.id, documentContext);
    var assistantMessage = { id: id('message'), role: 'assistant', speakerName: candidate.identity.name, text: response.text,
      createdAt: now(), source: response.source, intent: response.intent, score: response.score, explanation: response.explanation,
      modelVersion: candidate.model && (response.source === 'model' || (response.source === 'unknown' && response.intent === null)) ? candidate.model.version : null };
    if (documentContext) assistantMessage.documentIds = documentContext.ids.slice();
    if (response.citations !== undefined) assistantMessage.citations = validateCitations(response.citations, assistantMessage.documentIds);
    appendBounded(candidate, 'messages', assistantMessage, LIMITS.messages);
    recordEvent(candidate, 'response', 'assistant', 'Réponse issue de : ' + response.source + (response.intent ? ' ; intention : ' + response.intent : '') + '.', userMessage.id);
    touch(candidate);
    commitMutation(state, candidate, ['messages', 'facts']);
    return response;
  }
  function previewMessage(state, text, options) {
    text = textValue(text, 'Message', LIMITS.message, false);
    var documentContext = selectedDocuments(state, options);
    var candidate = mutationCandidate(state, { messages: state.messages.slice(), facts: state.facts.map(function (fact) { return Object.assign({}, fact); }) });
    var userMessage = { id: id('preview'), role: 'user', text: text, createdAt: now() };
    appendBounded(candidate, 'messages', userMessage, LIMITS.messages);
    return processMessage(candidate, text, userMessage.id, documentContext);
  }
  function handleGeneratedMessage(state, text, result, options) {
    text = textValue(text, 'Message', LIMITS.message, false);
    keysOnly(result, ['text', 'generation', 'citations'], 'Réponse générée');
    options = options || {};
    keysOnly(options, ['documentIds', 'contextCitations'], 'Options de génération');
    var documentContext = selectedDocuments(state, { documentIds: options.documentIds || [] });
    var documentIds = documentContext ? documentContext.ids : [];
    var provided = validateCitations(options.contextCitations || [], documentIds, documentContext ? documentContext.documents : []);
    var citations = validateCitations(result.citations || [], documentIds, documentContext ? documentContext.documents : []);
    citations.forEach(function (citation) {
      if (!provided.some(function (source) { return source.documentId === citation.documentId && source.name === citation.name && source.page === citation.page && source.excerpt === citation.excerpt; })) fail('La génération ne peut citer qu’un passage réellement fourni dans son contexte.');
    });
    var generation = validateGeneration(result.generation);
    var response = answer(textValue(result.text, 'Réponse générée', LIMITS.assistantMessage, false), 'generation', null, null,
      'Réponse rédigée localement par ' + generation.modelId + ' (' + generation.modelFile + '), moteur ' + generation.runtime + ' ' + generation.runtimeVersion + '. ' +
      'Les références présentent les passages fournis au modèle ; elles ne garantissent pas chaque affirmation. Cette réponse ne modifie ni vos souvenirs ni le classifieur à six intentions.');
    response.citations = citations;
    response.generation = generation;
    var candidate = mutationCandidate(state, { messages: state.messages.slice() });
    var userMessage = { id: id('message'), role: 'user', speakerName: state.identity.userName || 'Utilisateur', text: text, createdAt: now() };
    var assistantMessage = { id: id('message'), role: 'assistant', speakerName: state.identity.name, text: response.text, createdAt: now(),
      source: 'generation', intent: null, score: null, explanation: response.explanation, modelVersion: null, generation: Object.assign({}, generation),
      citations: citations.map(function (citation) { return Object.assign({}, citation); }) };
    if (documentContext) { userMessage.documentIds = documentIds.slice(); assistantMessage.documentIds = documentIds.slice(); }
    appendBounded(candidate, 'messages', userMessage, LIMITS.messages);
    appendBounded(candidate, 'messages', assistantMessage, LIMITS.messages);
    recordEvent(candidate, 'response', 'assistant', 'Réponse générée localement : ' + generation.modelId + ' ; ' + generation.outputTokens + ' jetons ; ' + citations.length + ' passages fournis conservés.', userMessage.id);
    touch(candidate);
    commitMutation(state, candidate, 'messages');
    return response;
  }

  function validateExample(example) {
    keysOnly(example, ['id', 'text', 'intent', 'origin', 'createdAt'], 'Exemple');
    var output = { id: textValue(example.id, 'Identifiant de l’exemple', 100, false), text: textValue(example.text, 'Texte de l’exemple', LIMITS.example, false), intent: validIntent(example.intent), origin: example.origin };
    if (output.origin !== 'starter' && output.origin !== 'user') fail('Origine de l’exemple invalide.');
    if (example.createdAt != null) output.createdAt = dateValue(example.createdAt, 'Date de l’exemple');
    return output;
  }
  function isHeldout(text) { var key = normalized(text); return HELDOUT.some(function (item) { return normalized(item.text) === key; }); }
  function addExample(state, text, intent) {
    text = textValue(text, 'Exemple', LIMITS.example, false);
    if (/[\r\n]/.test(text)) fail('Saisissez une seule formulation ; utilisez l’ajout par lignes pour plusieurs exemples.');
    var result = addExamples(state, text, intent);
    if (!result.added) fail('Cet exemple existe déjà.');
    return result.examples[0];
  }
  function mutationCandidate(state, changes) {
    return Object.assign({}, state, changes, {
      events: state.events.slice(),
      meta: state.meta ? Object.assign({}, state.meta) : { createdAt: now(), updatedAt: now() },
      retention: Object.assign({ messagesDropped: 0, eventsDropped: 0, trainingRunsDropped: 0 }, state.retention || {})
    });
  }
  function commitMutation(state, candidate, field) {
    exportState(candidate);
    (Array.isArray(field) ? field : [field]).forEach(function (name) { state[name] = candidate[name]; });
    state.events = candidate.events;
    state.meta = candidate.meta;
    state.retention = candidate.retention;
  }
  function exampleIssue(text, intent) {
    var key = normalized(text);
    if (/^(?:ajouter des exemples|une formulation par ligne)$/.test(key) ||
        /^(?:change|choisis|selectionne) (?:ensuite )?l intention .* (?:ligne|exemple)s?$/.test(key)) {
      return { instruction:true, message:'Cette ligne appartient à la notice. Retirez-la des exemples.' };
    }
    if (intent === 'recall' && /^(?:ajout(?:e|ez|er)|memorise|enregistre) .+ (?:a|dans) (?:ta |la |ma )?memoire\b/.test(key)) {
      return { suggested:'remember', message:'Cette demande semble ajouter une information. Vérifiez la catégorie Mémoriser.' };
    }
    return null;
  }
  function addExamples(state, multilineText, intent) {
    validIntent(intent);
    if (typeof multilineText !== 'string' || multilineText.length > LIMITS.examples * (LIMITS.example + 2)) fail('Le lot de formulations dépasse la limite autorisée.');
    var lines = multilineText.split(/\r\n?|\n/).map(function (line) { return line.trim(); }).filter(Boolean);
    if (!lines.length) fail('Ajoutez au moins une formulation, une par ligne.');
    var known = Object.create(null), pending = [], skipped = 0;
    state.examples.forEach(function (item) {
      var key = normalized(item.text);
      known[key] = known[key] && known[key] !== item.intent ? 'conflict' : item.intent;
    });
    lines.forEach(function (line) {
      var text = textValue(line, 'Exemple', LIMITS.example, false), key = normalized(text);
      if (text.indexOf('=') >= 0) fail('Le signe « = » ne crée pas d’équivalence. Écrivez chaque formulation seule, une par ligne, puis choisissez sa catégorie. Aucun exemple de ce lot n’a été ajouté.');
      var issue = exampleIssue(text,intent);
      if (issue && issue.instruction) fail(issue.message + ' « ' + text + ' »');
      if (!contentWords(text).length) fail('Cet exemple ne contient aucun mot exploitable.');
      if (isHeldout(text)) fail('Cette formulation appartient au petit jeu d’évaluation réservé. Choisissez une autre formulation.');
      if (known[key]) {
        if (known[key] !== intent) fail('Cette formulation possède déjà une autre catégorie. Aucun exemple de ce lot n’a été ajouté.');
        skipped += 1; return;
      }
      known[key] = intent;
      pending.push(text);
    });
    if (state.examples.length + pending.length > LIMITS.examples) fail('La limite de ' + LIMITS.examples + ' exemples serait dépassée. Aucun exemple de ce lot n’a été ajouté.');
    if (!pending.length) return { added: 0, skipped: skipped, examples: [] };
    var additions = pending.map(function (text) { return { id: id('example'), text: text, intent: intent, origin: 'user', createdAt: now() }; });
    var candidate = mutationCandidate(state, { examples: state.examples.concat(additions) });
    additions.forEach(function (item) { recordEvent(candidate, 'example_added', 'user', 'Exemple ajouté pour la catégorie « ' + intent + ' » : ' + item.text); });
    commitMutation(state, candidate, 'examples');
    return { added: additions.length, skipped: skipped, examples: additions };
  }
  function addDocument(state, document) {
    var existing = state.documents == null ? [] : state.documents;
    if (!Array.isArray(existing)) fail('La liste des documents est invalide.');
    var documents = documentModule().validateDocuments(existing.concat([document]));
    var added = documents[documents.length - 1], candidate = mutationCandidate(state, { documents: documents });
    recordEvent(candidate, 'document_added', 'user', 'Document importé volontairement : ' + added.name + ' ; type : ' + added.kind + ' ; taille : ' + added.size + ' octets.');
    commitMutation(state, candidate, 'documents');
    return added;
  }
  function removeDocument(state, documentId) {
    documentId = textValue(documentId, 'Identifiant de document', 100, false);
    var documents = validateDocumentList(state.documents == null ? [] : state.documents);
    var removed = documents.filter(function (document) { return document.id === documentId; })[0];
    if (!removed) return false;
    var candidate = mutationCandidate(state, { documents: documents.filter(function (document) { return document.id !== documentId; }) });
    recordEvent(candidate, 'document_removed', 'user', 'Document retiré : ' + removed.name + '. Les messages déjà conservés restent dans l’historique.');
    commitMutation(state, candidate, 'documents');
    return true;
  }
  function refreshDocument(state, documentId, refreshedDoc) {
    documentId = textValue(documentId, 'Identifiant de document', 100, false);
    var documents = validateDocumentList(state.documents == null ? [] : state.documents);
    var previous = documents.filter(function (document) { return document.id === documentId; })[0];
    if (!previous) fail('Le document à relire est absent.');
    plain(refreshedDoc, 'Document relu');
    ['id', 'name', 'mime', 'size', 'kind', 'sha256', 'dataBase64'].forEach(function (field) {
      if (refreshedDoc[field] !== previous[field]) fail('La relecture doit conserver le même original et ses métadonnées : ' + field + '.');
    });
    var refreshed = documentModule().validateDocuments([Object.assign({}, refreshedDoc, { addedAt: previous.addedAt })])[0];
    var candidate = mutationCandidate(state, { documents: documents.map(function (document) { return document.id === documentId ? refreshed : document; }) });
    recordEvent(candidate, 'document_refreshed', 'user', 'Document relu : ' + refreshed.name + ' ; ' + refreshed.extraction.processedPages +
      ' pages ou segments traités ; ' + refreshed.pages.reduce(function (total, page) { return total + page.text.length; }, 0) + ' caractères extraits. Original et date d’ajout conservés.');
    commitMutation(state, candidate, 'documents');
    return refreshed;
  }
  function vocabularyFor(examples) {
    var counts = Object.create(null);
    examples.forEach(function (item) { featureNames(item.text).forEach(function (key) { counts[key] = (counts[key] || 0) + 1; }); });
    return Object.keys(counts).sort(function (a, b) {
      var ua = a.slice(0, 2) === 'w:', ub = b.slice(0, 2) === 'w:';
      if (ua !== ub) return ua ? -1 : 1;
      return counts[b] - counts[a] || (a < b ? -1 : a > b ? 1 : 0);
    }).slice(0, LIMITS.features);
  }
  function vocabularyIndex(model) { var result = Object.create(null); model.vocabulary.forEach(function (name, index) { result[name] = index; }); return result; }
  function vectorFor(text, model, index) {
    var words = contentWords(text), seen = Object.create(null), known = 0;
    words.forEach(function (word) { if (Object.prototype.hasOwnProperty.call(index, 'w:' + word)) known += 1; });
    var indices = [];
    featureNames(text).forEach(function (name) { if (Object.prototype.hasOwnProperty.call(index, name) && !seen[name]) { indices.push(index[name]); seen[name] = true; } });
    return { indices: indices, scale: indices.length ? 1 / Math.sqrt(indices.length) : 0, coverage: words.length ? known / words.length : 0, knownWords: known, totalWords: words.length };
  }
  function probabilities(model, vector) {
    var scores = [], maximum = -Infinity, sum = 0, c, f;
    for (c = 0; c < CLASSES.length; c += 1) {
      var score = model.bias[c], offset = c * model.featureCount;
      for (f = 0; f < vector.indices.length; f += 1) score += model.weights[offset + vector.indices[f]] * vector.scale;
      scores.push(score); if (score > maximum) maximum = score;
    }
    for (c = 0; c < scores.length; c += 1) { scores[c] = Math.exp(scores[c] - maximum); sum += scores[c]; }
    return scores.map(function (value) { return value / sum; });
  }
  function modelStats(model, dataset) {
    var loss = 0, correct = 0;
    dataset.forEach(function (sample) {
      var p = probabilities(model, sample.vector), predicted = 0;
      for (var c = 1; c < p.length; c += 1) if (p[c] > p[predicted]) predicted = c;
      loss -= Math.log(Math.max(1e-12, p[sample.target]));
      if (predicted === sample.target) correct += 1;
    });
    return { loss: loss / dataset.length, accuracy: correct / dataset.length };
  }
  function clock() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
  function train(examples, options) {
    options = options || {};
    var start = clock(), clean = list(examples, 'Exemples', LIMITS.examples).map(validateExample);
    if (clean.length < CLASSES.length) fail('Ajoutez au moins un exemple pour chacune des six catégories.');
    var observed = Object.create(null), texts = Object.create(null);
    clean.forEach(function (item) {
      if (isHeldout(item.text)) fail('Les exemples d’évaluation réservés doivent rester hors de l’entraînement.');
      if (!contentWords(item.text).length) fail('Un exemple ne contient aucun mot exploitable.');
      var key = normalized(item.text);
      if (texts[key]) fail('Deux exemples utilisent la même formulation ; corrigez ce doublon avant l’entraînement.');
      texts[key] = true; observed[item.intent] = true;
    });
    if (CLASSES.some(function (category) { return !observed[category]; })) fail('Chaque catégorie doit posséder au moins un exemple.');
    var epochs = options.epochs == null ? DEFAULT_EPOCHS : integer(options.epochs, 'Nombre d’itérations', 1, MAX_EPOCHS);
    var learningRate = options.learningRate == null ? 0.8 : finite(options.learningRate, 'Pas d’apprentissage', 0.01, 2);
    var vocabulary = vocabularyFor(clean), featureCount = vocabulary.length;
    var model = { schemaVersion: 1, algorithm: 'softmax-bag-of-words', version: id('model'), classes: CLASSES.slice(), vocabulary: vocabulary,
      featureCount: featureCount, weights: new Array(CLASSES.length * featureCount).fill(0), bias: new Array(CLASSES.length).fill(0),
      trainedAt: now(), examplesUsed: clean.length,
      config: { epochs: epochs, learningRate: learningRate, l2: 0.001, seed: 0, initialization: 'zeros', featureLimit: LIMITS.features },
      thresholds: { score: 0.60, margin: 0.15, coverage: 0.34 } };
    var index = vocabularyIndex(model), data = clean.map(function (item) { return { vector: vectorFor(item.text, model, index), target: CLASSES.indexOf(item.intent) }; });
    var before = modelStats(model, data), n = data.length;
    for (var epoch = 0; epoch < epochs; epoch += 1) {
      var gradient = new Float64Array(model.weights.length), biasGradient = new Float64Array(CLASSES.length);
      data.forEach(function (sample) {
        var p = probabilities(model, sample.vector);
        for (var c = 0; c < CLASSES.length; c += 1) {
          var delta = (p[c] - (c === sample.target ? 1 : 0)) / n;
          biasGradient[c] += delta;
          var offset = c * featureCount;
          for (var f = 0; f < sample.vector.indices.length; f += 1) gradient[offset + sample.vector.indices[f]] += delta * sample.vector.scale;
        }
      });
      for (var weight = 0; weight < model.weights.length; weight += 1) model.weights[weight] -= learningRate * (gradient[weight] + model.config.l2 * model.weights[weight]);
      for (var b = 0; b < CLASSES.length; b += 1) model.bias[b] -= learningRate * biasGradient[b];
      if (typeof options.onProgress === 'function' && ((epoch + 1) % 10 === 0 || epoch + 1 === epochs)) options.onProgress({ epoch: epoch + 1, epochs: epochs, progress: (epoch + 1) / epochs });
    }
    var after = modelStats(model, data);
    return { model: model, config: clone(model.config), metrics: { epochs: epochs, examples: n, lossBefore: before.loss, lossAfter: after.loss,
      accuracyBefore: before.accuracy, accuracyAfter: after.accuracy, durationMs: Math.max(0, clock() - start) } };
  }
  function predict(model, text) {
    text = textValue(text, 'Texte à classer', LIMITS.message, false);
    if (!model) return { intent: null, score: null, margin: null, accepted: false, reason: 'Aucun modèle entraîné.', coverage: 0, scores: [] };
    var vector = vectorFor(text, model, vocabularyIndex(model));
    if (!vector.indices.length || !vector.knownWords) return { intent: null, score: null, margin: null, accepted: false, reason: 'Aucun mot utile de cette demande n’est connu du modèle.', coverage: 0, scores: [] };
    var p = probabilities(model, vector), sorted = CLASSES.map(function (intent, index) { return { intent: intent, score: p[index] }; }).sort(function (a, b) { return b.score - a.score; });
    var score = sorted[0].score, margin = score - sorted[1].score;
    var accepted = score >= model.thresholds.score && margin >= model.thresholds.margin && vector.coverage >= model.thresholds.coverage;
    return { intent: accepted ? sorted[0].intent : null, candidateIntent: sorted[0].intent, score: score, margin: margin, accepted: accepted,
      reason: accepted ? 'Intention proposée dans le périmètre limité des six catégories.' : 'Le modèle refuse cette demande : score, séparation des catégories ou couverture du vocabulaire insuffisant.',
      coverage: vector.coverage, knownWords: vector.knownWords, totalWords: vector.totalWords, scores: sorted };
  }
  function evaluate(model) {
    var results = HELDOUT.map(function (sample) {
      var p = predict(model, sample.text);
      return { text: sample.text, expected: sample.expected, predicted: p.intent, correct: p.intent === sample.expected,
        score: p.score, margin: p.margin, accepted: p.accepted };
    });
    var correct = results.filter(function (result) { return result.correct; }).length;
    return { correct: correct, total: results.length, accuracy: correct / results.length, results: results,
      note: 'Petit jeu fixe de formulations réservées, distinct de l’entraînement. Des essais répétés peuvent guider vos choix : ce n’est pas une mesure générale de compréhension du français.' };
  }
  function evaluateExamples(model, examples) {
    var results = list(examples, 'Exemples à vérifier', LIMITS.examples).map(function (sample) {
      plain(sample, 'Exemple à vérifier');
      var text = textValue(sample.text, 'Formulation à vérifier', LIMITS.example, false), expected = validIntent(sample.intent);
      var p = predict(model, text);
      return { text: text, expected: expected, predicted: p.intent, correct: p.intent === expected,
        score: p.score, margin: p.margin, accepted: p.accepted };
    });
    var correct = results.filter(function (result) { return result.correct; }).length;
    return { correct: correct, total: results.length, accuracy: results.length ? correct / results.length : null, results: results,
      note: results.length ? 'Contrôle des formulations fournies avec les mêmes seuils de refus. Ces exemples ont pu servir à l’entraînement ; ce score ne remplace pas le jeu de contrôle réservé.' : 'Aucune formulation personnelle à vérifier ; aucun taux de réussite n’est calculé.' };
  }

  function validateModel(value) {
    if (value === null) return null;
    keysOnly(value, ['schemaVersion', 'algorithm', 'version', 'classes', 'vocabulary', 'featureCount', 'weights', 'bias', 'trainedAt', 'examplesUsed', 'config', 'thresholds'], 'Modèle');
    if (value.schemaVersion !== 1 || value.algorithm !== 'softmax-bag-of-words') fail('Format de modèle non reconnu.');
    var classes = list(value.classes, 'Catégories du modèle', 6);
    if (classes.length !== CLASSES.length || classes.some(function (entry, index) { return entry !== CLASSES[index]; })) fail('Ordre des catégories du modèle invalide.');
    var vocabulary = list(value.vocabulary, 'Vocabulaire', LIMITS.features).map(function (entry) { return textValue(entry, 'Caractéristique', 100, false); });
    if (!vocabulary.length || vocabulary.some(function (entry) { return !/^(w:[a-z0-9]+|b:[a-z0-9]+\|[a-z0-9]+)$/.test(entry); })) fail('Caractéristiques de modèle invalides.');
    if (new Set(vocabulary).size !== vocabulary.length) fail('Caractéristiques de modèle dupliquées.');
    var featureCount = integer(value.featureCount, 'Nombre de caractéristiques', 1, LIMITS.features);
    if (featureCount !== vocabulary.length) fail('Dimensions de vocabulaire incohérentes.');
    var weights = list(value.weights, 'Poids du modèle', LIMITS.features * 6).map(function (entry) { return finite(entry, 'Poids', -1000, 1000); });
    var bias = list(value.bias, 'Biais du modèle', 6).map(function (entry) { return finite(entry, 'Biais', -1000, 1000); });
    if (weights.length !== featureCount * CLASSES.length || bias.length !== CLASSES.length) fail('Dimensions des paramètres incohérentes.');
    keysOnly(value.config, ['epochs', 'learningRate', 'l2', 'seed', 'initialization', 'featureLimit'], 'Configuration');
    var config = { epochs: integer(value.config.epochs, 'Itérations', 1, MAX_EPOCHS), learningRate: finite(value.config.learningRate, 'Pas', 0.01, 2),
      l2: finite(value.config.l2, 'Régularisation', 0, 1), seed: integer(value.config.seed, 'Graine', 0, 2147483647),
      initialization: value.config.initialization, featureLimit: integer(value.config.featureLimit, 'Limite des caractéristiques', 1, LIMITS.features) };
    if (config.initialization !== 'zeros') fail('Initialisation de modèle inconnue.');
    keysOnly(value.thresholds, ['score', 'margin', 'coverage'], 'Seuils');
    var thresholds = { score: finite(value.thresholds.score, 'Seuil de score', 0.5, 0.99), margin: finite(value.thresholds.margin, 'Seuil de marge', 0.1, 0.95), coverage: finite(value.thresholds.coverage, 'Seuil de couverture', 0.2, 1) };
    return { schemaVersion: 1, algorithm: value.algorithm, version: textValue(value.version, 'Version du modèle', 100, false), classes: CLASSES.slice(), vocabulary: vocabulary,
      featureCount: featureCount, weights: weights, bias: bias, trainedAt: dateValue(value.trainedAt, 'Date d’entraînement'), examplesUsed: integer(value.examplesUsed, 'Exemples utilisés', 6, LIMITS.examples), config: config, thresholds: thresholds };
  }
  function validateEvaluation(value) {
    keysOnly(value, ['correct', 'total', 'accuracy', 'results', 'note'], 'Évaluation');
    var total = integer(value.total, 'Total évalué', 1, 200), correct = integer(value.correct, 'Résultats corrects', 0, total), accuracy = finite(value.accuracy, 'Exactitude', 0, 1);
    if (Math.abs(accuracy - correct / total) > 1e-9) fail('Mesures d’évaluation incohérentes.');
    var results = list(value.results, 'Résultats d’évaluation', 200).map(function (entry) {
      keysOnly(entry, ['text', 'expected', 'predicted', 'correct', 'score', 'margin', 'accepted'], 'Résultat d’évaluation');
      var item = { text: textValue(entry.text, 'Formulation évaluée', LIMITS.example, false), expected: validIntent(entry.expected), predicted: entry.predicted === null ? null : validIntent(entry.predicted), correct: entry.correct };
      if (typeof item.correct !== 'boolean' || item.correct !== (item.expected === item.predicted)) fail('Résultat d’évaluation incohérent.');
      if (entry.score !== undefined) item.score = entry.score === null ? null : finite(entry.score, 'Score', 0, 1);
      if (entry.margin !== undefined) item.margin = entry.margin === null ? null : finite(entry.margin, 'Marge', 0, 1);
      if (entry.accepted !== undefined) { if (typeof entry.accepted !== 'boolean') fail('Acceptation invalide.'); item.accepted = entry.accepted; }
      return item;
    });
    if (results.length !== total || results.filter(function (item) { return item.correct; }).length !== correct) fail('Décompte d’évaluation incohérent.');
    var output = { correct: correct, total: total, accuracy: accuracy, results: results };
    if (value.note != null) output.note = textValue(value.note, 'Note d’évaluation', 1000, true);
    return output;
  }
  function validateMetrics(value) {
    var fields = ['epochs', 'examples', 'lossBefore', 'lossAfter', 'accuracyBefore', 'accuracyAfter', 'durationMs'];
    keysOnly(value, fields, 'Mesures d’entraînement');
    if (fields.some(function (field) { return !Object.prototype.hasOwnProperty.call(value, field); })) fail('Mesures d’entraînement incomplètes. Omettez ce bloc si aucune mesure n’a été conservée.');
    var output = {};
    Object.keys(value).forEach(function (key) {
      if (key === 'epochs') output[key] = integer(value[key], key, 1, MAX_EPOCHS);
      else if (key === 'examples') output[key] = integer(value[key], key, 1, LIMITS.examples);
      else if (key.indexOf('accuracy') === 0) output[key] = finite(value[key], key, 0, 1);
      else output[key] = finite(value[key], key, 0, key === 'durationMs' ? 86400000 : 1000000);
    });
    return output;
  }
  function validateRun(value) {
    keysOnly(value, ['id', 'createdAt', 'status', 'modelVersion', 'metrics', 'evaluationBefore', 'evaluationAfter', 'examplesSnapshot', 'parametersSnapshot', 'config', 'reason'], 'Séance');
    if (['evaluated', 'adopted', 'rejected', 'rolled_back'].indexOf(value.status) < 0) fail('Statut de séance inconnu.');
    var output = { id: textValue(value.id, 'Identifiant de séance', 100, false), createdAt: dateValue(value.createdAt, 'Date de séance'), status: value.status };
    if (value.modelVersion != null) output.modelVersion = textValue(value.modelVersion, 'Version de séance', 100, false);
    if (value.metrics != null) output.metrics = validateMetrics(value.metrics);
    if (value.evaluationBefore != null) output.evaluationBefore = validateEvaluation(value.evaluationBefore);
    if (value.evaluationAfter != null) output.evaluationAfter = validateEvaluation(value.evaluationAfter);
    if (value.examplesSnapshot != null) output.examplesSnapshot = list(value.examplesSnapshot, 'Exemples de la séance', LIMITS.examples).map(validateExample);
    if (value.parametersSnapshot != null) output.parametersSnapshot = validateModel(value.parametersSnapshot);
    if (value.config != null) {
      keysOnly(value.config, ['epochs', 'learningRate', 'l2', 'seed', 'initialization', 'featureLimit'], 'Configuration de séance');
      output.config = {};
      Object.keys(value.config).forEach(function (key) {
        if (key === 'initialization') { if (value.config[key] !== 'zeros') fail('Initialisation inconnue.'); output.config[key] = value.config[key]; }
        else if (key === 'epochs') output.config[key] = integer(value.config[key], 'Itérations de séance', 1, MAX_EPOCHS);
        else output.config[key] = finite(value.config[key], 'Configuration de séance', 0, key === 'seed' ? 2147483647 : 1000);
      });
    }
    if (value.reason != null) output.reason = textValue(value.reason, 'Motif de séance', 2000, true);
    return output;
  }
  function safeTree(value, depth) {
    if (depth > 14) fail('Sauvegarde trop imbriquée.');
    if (typeof value === 'number' && !Number.isFinite(value)) fail('Nombre non fini dans la sauvegarde.');
    if (value && typeof value === 'object') {
      Object.keys(value).forEach(function (key) {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') fail('Clé dangereuse dans la sauvegarde.');
        safeTree(value[key], depth + 1);
      });
    }
  }
  function validateState(value) {
    safeTree(value, 0);
    keysOnly(value, ['schemaVersion', 'meta', 'identity', 'facts', 'documents', 'examples', 'model', 'previousModel', 'messages', 'events', 'trainingRuns', 'retention'], 'Sauvegarde');
    if (value.schemaVersion !== 1) fail('Version de sauvegarde non prise en charge.');
    keysOnly(value.identity, ['name', 'role', 'userName'], 'Identité');
    var output = { schemaVersion: 1, identity: { name: textValue(value.identity.name, 'Nom de l’agent', 60, false), role: textValue(value.identity.role, 'Rôle', 240, false), userName: textValue(value.identity.userName, 'Nom utilisateur', 60, true) } };
    if (value.meta) {
      keysOnly(value.meta, ['createdAt', 'updatedAt'], 'Métadonnées');
      output.meta = { createdAt: dateValue(value.meta.createdAt, 'Date de création'), updatedAt: dateValue(value.meta.updatedAt, 'Date de modification') };
    } else output.meta = { createdAt: now(), updatedAt: now() };
    output.facts = list(value.facts, 'Faits', LIMITS.facts).map(function (fact) {
      keysOnly(fact, ['id', 'key', 'value', 'author', 'createdAt', 'updatedAt'], 'Fait');
      if (fact.author !== 'user') fail('Un fait doit rester attribué à une déclaration utilisateur.');
      return { id: textValue(fact.id, 'Identifiant de fait', 100, false), key: textValue(fact.key, 'Clé du fait', 80, false), value: textValue(fact.value, 'Valeur du fait', 500, false), author: 'user', createdAt: dateValue(fact.createdAt, 'Création du fait'), updatedAt: dateValue(fact.updatedAt, 'Mise à jour du fait') };
    });
    ensureUnique(output.facts, 'id', 'Faits');
    var factKeys = Object.create(null);
    output.facts.forEach(function (fact) { var key = normalized(fact.key); if (!key || factKeys[key]) fail('Clé de fait absente ou dupliquée.'); factKeys[key] = true; });
    output.documents = validateDocumentList(value.documents === undefined ? [] : value.documents);
    output.examples = list(value.examples, 'Exemples', LIMITS.examples).map(validateExample);
    ensureUnique(output.examples, 'id', 'Exemples');
    output.examples.forEach(function (example) { if (isHeldout(example.text)) fail('Une sauvegarde ne peut pas placer un exemple réservé dans l’entraînement.'); });
    output.model = validateModel(value.model);
    output.previousModel = validateModel(value.previousModel);
    output.messages = list(value.messages, 'Messages', LIMITS.messages).map(function (message) {
      keysOnly(message, ['id', 'role', 'speakerName', 'text', 'createdAt', 'source', 'intent', 'score', 'explanation', 'modelVersion', 'documentIds', 'citations', 'generation'], 'Message');
      if (message.role !== 'user' && message.role !== 'assistant') fail('Auteur du message invalide.');
      var item = { id: textValue(message.id, 'Identifiant du message', 100, false), role: message.role, text: textValue(message.text, 'Message', message.role === 'assistant' ? LIMITS.assistantMessage : LIMITS.message, false), createdAt: dateValue(message.createdAt, 'Date du message') };
      if (message.speakerName !== undefined) item.speakerName = textValue(message.speakerName, 'Nom au moment du message', 60, false);
      if (message.modelVersion !== undefined) item.modelVersion = message.modelVersion === null ? null : textValue(message.modelVersion, 'Version utilisée pour le message', 100, false);
      // Historical selections survive removal of the original attachments.
      if (message.documentIds !== undefined) item.documentIds = validateDocumentIds(message.documentIds);
      if (message.source != null) { if (['rule', 'model', 'memory', 'unknown', 'document', 'generation'].indexOf(message.source) < 0) fail('Source de réponse inconnue.'); item.source = message.source; }
      if (message.intent !== undefined) item.intent = message.intent === null ? null : validIntent(message.intent);
      if (message.score !== undefined) item.score = message.score === null ? null : finite(message.score, 'Score de réponse', 0, 1);
      if (message.explanation !== undefined) item.explanation = textValue(message.explanation, 'Explication de réponse', 4000, true);
      if (message.citations !== undefined) {
        if (message.role !== 'assistant' || ['document', 'generation'].indexOf(message.source) < 0) fail('Seule une réponse documentaire ou générée peut conserver des citations.');
        // Historical evidence remains readable after removal or re-extraction.
        item.citations = validateCitations(message.citations, item.documentIds);
      }
      if (message.source === 'generation') {
        if (message.role !== 'assistant' || message.modelVersion != null || message.score != null || message.intent != null) fail('Une réponse générée doit rester distincte du classifieur.');
        item.generation = validateGeneration(message.generation);
      } else if (message.generation !== undefined) fail('La provenance générative doit appartenir à une réponse générée.');
      return item;
    });
    ensureUnique(output.messages, 'id', 'Messages');
    output.events = list(value.events, 'Journal', LIMITS.events).map(function (event) {
      keysOnly(event, ['id', 'type', 'author', 'detail', 'createdAt', 'messageId'], 'Événement');
      if (['user', 'assistant', 'system'].indexOf(event.author) < 0) fail('Auteur de journal invalide.');
      var item = { id: textValue(event.id, 'Identifiant du journal', 100, false), type: textValue(event.type, 'Type d’événement', 100, false), author: event.author, detail: textValue(event.detail, 'Détail du journal', 2000, true), createdAt: dateValue(event.createdAt, 'Date du journal') };
      if (event.messageId != null) item.messageId = textValue(event.messageId, 'Message associé', 100, false);
      return item;
    });
    ensureUnique(output.events, 'id', 'Journal');
    output.trainingRuns = list(value.trainingRuns, 'Séances', LIMITS.trainingRuns).map(validateRun);
    ensureUnique(output.trainingRuns, 'id', 'Séances');
    output.retention = { messagesDropped: 0, eventsDropped: 0, trainingRunsDropped: 0 };
    if (value.retention) {
      keysOnly(value.retention, Object.keys(output.retention), 'Rétention');
      Object.keys(output.retention).forEach(function (key) { output.retention[key] = integer(value.retention[key] == null ? 0 : value.retention[key], 'Compteur de rétention', 0, 1000000000); });
    }
    return output;
  }
  function byteLength(text) {
    var bytes = 0;
    for (var i = 0; i < text.length; i += 1) {
      var code = text.charCodeAt(i);
      if (code < 128) bytes += 1;
      else if (code < 2048) bytes += 2;
      else if (code >= 0xD800 && code <= 0xDBFF && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xDC00 && text.charCodeAt(i + 1) <= 0xDFFF) { bytes += 4; i += 1; }
      else bytes += 3;
    }
    return bytes;
  }
  function exportState(state) {
    var output = JSON.stringify(validateState(state), null, 2);
    if (byteLength(output) > LIMITS.importBytes) fail('La sauvegarde dépasse 25 Mo. Exportez des archives puis réduisez l’historique avant un nouvel export restaurable.');
    return output;
  }
  function importState(json) {
    if (typeof json !== 'string' || json.length > LIMITS.importBytes || byteLength(json) > LIMITS.importBytes) fail('La sauvegarde doit être un texte JSON de moins de 25 Mo.');
    var value;
    try { value = JSON.parse(json); } catch (error) { fail('Le fichier ne contient pas un JSON valide.'); }
    return validateState(value);
  }
  function appendTrainingRun(state, run) {
    var clean = validateRun(run);
    // Build and validate the prospective archive before mutating live data. A failed
    // addition must leave both the current history and its retention counters intact.
    var candidate = Object.assign({}, state, {
      trainingRuns: state.trainingRuns.slice(),
      meta: state.meta ? Object.assign({}, state.meta) : { createdAt: now(), updatedAt: now() },
      retention: Object.assign({ messagesDropped: 0, eventsDropped: 0, trainingRunsDropped: 0 }, state.retention || {})
    });
    appendBounded(candidate, 'trainingRuns', clean, LIMITS.trainingRuns);
    touch(candidate);
    try { exportState(candidate); }
    catch (error) {
      if (error.message.indexOf('25 Mo') >= 0) fail('Cette séance ferait dépasser le budget de sauvegarde de 25 Mo. L’historique actuel est inchangé : exportez-le puis réduisez les anciennes séances avant de recommencer.');
      throw error;
    }
    state.trainingRuns = candidate.trainingRuns;
    state.retention = candidate.retention;
    state.meta = candidate.meta;
    return clean;
  }
  function runSelfTests() {
    var results = [];
    function check(name, fn) {
      try { fn(); results.push({ name: name, passed: true, detail: 'Vérification réussie sur un état isolé.' }); }
      catch (error) { results.push({ name: name, passed: false, detail: error.message }); }
    }
    function assert(condition, message) { if (!condition) fail(message); }
    check('« Je » suit le locuteur', function () { assert(referent('je', 'lea', 'poi') === 'lea' && referent('je', 'poi', 'lea') === 'poi', 'Attribution erronée.'); });
    check('« Tu » suit le destinataire', function () { assert(referent('tu', 'lea', 'poi') === 'poi' && referent('tu', 'poi', 'lea') === 'lea', 'Attribution erronée.'); });
    check('Information absente signalée', function () { assert(referent('elle', 'lea', 'poi') === null && referent('je', null, 'poi') === null, 'Référent absent inventé.'); });
    check('Identité disponible sans entraînement', function () { var state = createState(); state.identity.name = 'Atlas'; assert(handleMessage(state, 'Quel est ton nom ?').text.indexOf('Atlas') >= 0 && state.model === null, 'Identité incohérente.'); });
    check('Mémoire, auteur et restauration JSON', function () {
      var state = createState(); handleMessage(state, 'Retiens : couleur préférée = bleu');
      var restored = importState(exportState(state));
      assert(restored.facts[0].author === 'user' && restored.messages.length === 2 && restored.events.length >= 2, 'Provenance perdue.');
      assert(handleMessage(restored, 'Que sais-tu sur couleur préférée ?').text.indexOf('bleu') >= 0, 'Fait non retrouvé.');
      assert(restored.model === null, 'Mémoriser a modifié le modèle.');
    });
    check('Fait inconnu non inventé', function () { assert(handleMessage(createState(), 'Que sais-tu sur adresse ?').source === 'unknown', 'Valeur absente inventée.'); });
    check('Import dangereux rejeté', function () { var rejected = false; try { importState('{"__proto__":{"polluted":true}}'); } catch (error) { rejected = true; } assert(rejected && !({}).polluted, 'Clé dangereuse acceptée.'); });
    check('Apprentissage réel et refus hors vocabulaire', function () {
      var result = train(SEED_EXAMPLES, { epochs: 120 });
      assert(result.metrics.lossAfter < result.metrics.lossBefore && result.model.weights.some(function (value) { return value !== 0; }), 'Aucune amélioration mesurée.');
      assert(!predict(result.model, 'volcan galaxie thermodynamique').accepted, 'Demande inconnue acceptée.');
      assert(evaluate(result.model).correct > 0, 'Aucune réussite sur les formulations réservées.');
    });
    return { passed: results.filter(function (item) { return item.passed; }).length, total: results.length, results: results };
  }

  return Object.freeze({ VERSION: VERSION, LIMITS: LIMITS, INTENTS: INTENTS, SEED_EXAMPLES: SEED_EXAMPLES,
    createState: createState, handleMessage: handleMessage, reply: handleMessage, previewMessage: previewMessage,
    handleGeneratedMessage: handleGeneratedMessage, referent: referent, train: train,
    predict: predict, evaluate: evaluate, evaluateExamples: evaluateExamples, exampleIssue: exampleIssue, addExample: addExample, addExamples: addExamples,
    addDocument: addDocument, removeDocument: removeDocument, refreshDocument: refreshDocument, exportState: exportState,
    importState: importState, runSelfTests: runSelfTests, recordEvent: recordEvent, appendTrainingRun: appendTrainingRun });
}));
