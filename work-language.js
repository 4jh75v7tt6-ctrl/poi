/* Cumulative, local Work command recognizer. No instruction is executed here. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.POIWorkLanguage = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var SCHEMA = 'poi.work-language.v1';
  var INTENTS = Object.freeze(['save', 'modify', 'tell', 'search', 'correct', 'create_component', 'document_watch', 'unknown']);
  var STOP = new Set(['je','tu','vous','le','la','les','un','une','de','du','des','dans','sur','pour','avec','moi','me','ma','mon','mes','ce','cette','ces','et','en','au','aux','a','il','elle','que','qui','est','puis','poi']);
  function words(s) { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]+/g) || []; }
  function features(s) {
    var w = words(s), set = new Set();
    w.forEach(function (v, i) { if (!STOP.has(v)) set.add('w:' + v); if (i && !STOP.has(w[i-1]) && !STOP.has(v)) set.add('b:' + w[i-1] + ':' + v); });
    return set;
  }
  // Remove common request openings before comparing action verbs. The label
  // still comes from a validated record in the selected Work.
  var REQUEST_PREFIX = /^(?:(?:s il (?:te|vous) plait|merci de|svp|(?:est ce que )?(?:tu (?:peux|pourrais)|vous (?:pouvez|pourriez)|peux tu|pourrais tu|pouvez vous|pourriez vous)|je (?:te|vous) demande de|poi) )+/;
  function verbForm(word) {
    if (!word) return '';
    if (['dis','dites','dire'].includes(word)) return 'dire';
    return word.length > 3 ? word.replace(/(?:er|ez|e)$/, '') : word;
  }
  // A grammatical hint, independent of classification labels. Related verbs
  // can share a family but only exact lemmas get a position bonus.
  var verbFamilies = new Map(), verbForms = new Map();
  [
    'chercher rechercher trouver', 'enregistrer sauvegarder consigner', 'garder conserver',
    'changer modifier ajuster', 'dire expliquer', 'corriger rectifier', 'creer',
    'lancer demarrer', 'ajouter', 'explorer', 'examiner inspecter',
    'reviser', 'noter', 'raconter', 'detailler', 'classer ranger',
    'deplacer', 'ignorer', 'effacer supprimer', 'dessiner', 'calculer',
    'lister enumerer', 'resumer', 'comparer', 'trier', 'copier', 'publier'
  ].forEach(function(group) {
    group.split(' ').forEach(function(verb) {
      var stem = verbForm(verb);
      verbFamilies.set(stem,group);
      var forms = verb === 'dire' ? ['dire','dis','dites'] : [verb,stem + 'e',stem + 'ez'];
      forms.forEach(function(form){verbForms.set(form,stem);});
    });
  });
  var FILLER = new Set(['nouveau','nouvel','nouvelle','nouveaux','nouvelles','l','d','s','n','te','ton','ta','tes','votre','vos',
    'pourquoi','comment','quoi','combien','quand','quel','quelle','quels','quelles','qu','c','sont','ai','suis','il','ils','elles','toujours','ici']);
  function command(text) {
    var parts = words(text).join(' ').replace(REQUEST_PREFIX, '').split(' ');
    var head = verbForms.get(parts[0]), family = verbFamilies.get(head);
    if (['note','classe','recherche','copie','garde','lance'].includes(parts[0]) && ['de','du','d'].includes(parts[1])) {
      head = undefined;
      family = undefined;
    }
    var content = parts.slice(1).filter(function(w){return !STOP.has(w) && !FILLER.has(w);});
    var negative = /^(?:ne|n|sans|pas|jamais) |(?:^| )(?:ne|n)(?: [a-z0-9]+){0,8} (?:pas|jamais|rien|plus|aucun|aucune)(?: |$)/.test(parts.join(' ')) ||
      /^(?:[a-z]+) (?:(?:moi|me|toi|te|nous|vous|lui|leur|le|la|les|en|y) ){0,3}(?:pas|jamais)(?: |$)/.test(parts.join(' '));
    var multiple = parts.some(function(word,i) {
      var next = parts[i+1] || '';
      return ['puis','ensuite'].includes(word) ||
        (['et','ou','sans','ni'].includes(word) && (verbForms.has(next) || ['ne','n'].includes(next))) ||
        (word === 'sans' && /(?:er|ir|re)$/.test(next));
    });
    return {head:head, family:family, argument:(content[0] || '').replace(/s$/, ''),
      content:new Set(content), simple:!negative && !multiple, negative:negative, multiple:multiple};
  }
  function sameScope(record, workId) {return !record.workId || record.workId === workId;}
  function key(s) { return words(s).join(' '); }
  function checkRecord(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).some(function(k){ return !['id','text','intent','workId','source','createdAt','split'].includes(k); })) throw Error('Champs de correction invalides.');
    if (typeof r.id !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(r.id)) throw Error('Identifiant invalide.');
    if (typeof r.text !== 'string' || !r.text.trim() || r.text.length > 500 || !features(r.text).size) throw Error('Consigne vide ou trop longue.');
    if (!INTENTS.includes(r.intent)) throw Error('Intention inconnue.');
    if (typeof r.workId !== 'string' || r.workId.length > 100) throw Error('Work invalide.');
    if (typeof r.source !== 'string' || !['user_correction','user_label'].includes(r.source)) throw Error('Source non validée.');
    if (typeof r.createdAt !== 'string' || !Number.isFinite(Date.parse(r.createdAt))) throw Error('Date invalide.');
    if (!['train','test'].includes(r.split)) throw Error('Séparation invalide.');
    return {id:r.id, text:r.text, intent:r.intent, workId:r.workId, source:r.source, createdAt:r.createdAt, split:r.split};
  }
  function empty() { return { schema: SCHEMA, records: [] }; }
  function validate(value) {
    if (!value || value.schema !== SCHEMA || !Array.isArray(value.records) || value.records.length > 10000 || Object.keys(value).some(function(k){return !['schema','records'].includes(k);})) throw Error('Format de corpus inconnu.');
    var ids = new Set(), texts = new Map();
    var records = value.records.map(function(raw){
      var r = checkRecord(raw), k = key(r.text);
      if (ids.has(r.id)) throw Error('Identifiant dupliqué.');
      var scopes = texts.get(k) || new Map();
      if ((scopes.has(r.workId) && scopes.get(r.workId) !== r.intent) ||
          (scopes.has('') && scopes.get('') !== r.intent) ||
          (!r.workId && Array.from(scopes.values()).some(function(intent){return intent !== r.intent;})))
        throw Error('Corrections contradictoires : ' + r.text);
      ids.add(r.id); scopes.set(r.workId,r.intent); texts.set(k,scopes); return r;
    });
    return {schema:SCHEMA, records:records};
  }
  function merge(base, incoming) {
    var a = validate(base), b = validate(incoming), byId = new Map();
    a.records.forEach(function(r){byId.set(r.id,r);});
    b.records.forEach(function(r){
      if (byId.has(r.id) && JSON.stringify(byId.get(r.id)) !== JSON.stringify(r)) throw Error('Identifiant déjà utilisé avec un autre contenu.');
      byId.set(r.id,r);
    });
    return validate({schema:SCHEMA,records:Array.from(byId.values())});
  }
  // Keep the V1 corpus portable. A reviewed proposal carries its provenance in its stable id.
  var TRANSFER_SCHEMA = 'poi.work-transfer.v1';
  function planTransfer(base, transfer, fallbackWork, reviewedAt) {
    var corpus = validate(base);
    if (!transfer || transfer.schema !== TRANSFER_SCHEMA || !Array.isArray(transfer.proposals) ||
        transfer.proposals.length > 10000 || typeof transfer.workId !== 'string' || transfer.workId.length > 100) {
      throw Error('Format du transfert Work invalide.');
    }
    var workId = transfer.workId || fallbackWork || '';
    var scopeHash = 2166136261;
    for (var c = 0; c < workId.length; c++) scopeHash = Math.imul(scopeHash ^ workId.charCodeAt(c), 16777619);
    var scopePrefix = (scopeHash >>> 0).toString(36) + '.';
    var byText = new Map(), byId = new Map(), proposals = new Map();
    corpus.records.forEach(function (r) {
      byId.set(r.id, r);
      byText.set(JSON.stringify([r.workId, key(r.text)]), r);
    });
    var added = [], existing = 0;
    transfer.proposals.forEach(function (proposal) {
      if (!proposal || !['practice_template','github_user_example'].includes(proposal.origin) ||
          typeof proposal.id !== 'string' || !/^[a-zA-Z0-9._-]{1,75}$/.test(proposal.id)) throw Error('Origine ou identifiant de suggestion invalide.');
      var signature = JSON.stringify([proposal.text, proposal.intent, proposal.split, proposal.origin]);
      if (proposals.has(proposal.id) && proposals.get(proposal.id) !== signature) throw Error('Identifiant de suggestion contradictoire.');
      proposals.set(proposal.id, signature);
      var prefix = proposal.origin === 'practice_template' ? 'practice.' : 'github.';
      var record = checkRecord({id:prefix + scopePrefix + proposal.id, text:proposal.text, intent:proposal.intent,
        workId:workId, source:'user_label', createdAt:reviewedAt, split:proposal.split});
      var textKey = JSON.stringify([workId, key(record.text)]);
      var sameId = byId.get(record.id);
      if (sameId && (sameId.text !== record.text || sameId.intent !== record.intent || sameId.split !== record.split ||
          sameId.workId !== workId)) throw Error('Identifiant de suggestion déjà utilisé pour une autre correction.');
      var prior = byText.get(textKey);
      if (prior && prior.intent !== record.intent) throw Error('Corrections contradictoires pour « ' + record.text + ' ».');
      if (prior && prior.split !== record.split) throw Error('Cette formulation figure déjà dans l’autre usage : ' + record.text);
      if (sameId || prior) { existing++; return; }
      byId.set(record.id, record);
      byText.set(textKey, record);
      added.push(record);
    });
    var next = merge(corpus, {schema:SCHEMA, records:added});
    return {corpus:next, added:added, existing:existing, workId:workId};
  }

  function buildIndex(records) {
    return records.filter(function(r){return r.split === 'train';}).map(function (r) {
      return {record:r, features:features(r.text), key:key(r.text), command:command(r.text)};
    });
  }

  function predictFrom(index, text, workId) {
    var query = features(text), form = command(text), exact = key(text);
    if (form.negative || form.multiple) return {intent:null, accepted:false, score:0, reason:'Négation ou actions multiples. La demande exige une précision.'};
    if (!query.size) return {intent:null, accepted:false, score:0, reason:'Consigne sans caractéristiques utiles.'};
    var eligible = index.filter(function(entry){return sameScope(entry.record,workId);});
    var sameHeadIntents = new Set(eligible.filter(function(entry){return entry.command.head === form.head;})
      .map(function(entry){return entry.record.intent;}));
    var familyIntents = new Set(eligible.filter(function (entry) {
      return form.family && entry.command.simple && entry.command.family === form.family;
    }).map(function (entry) { return entry.record.intent; }));
    var best = new Map();
    eligible.forEach(function (entry) {
      var record = entry.record, score;
      if (entry.key === exact) {
        score = 1;
      } else {
        var learned = entry.command;
        if (!form.simple || !learned.simple || !form.content.size || !learned.content.size || form.family !== learned.family) return;
        // Compound operations and verbs learned with several labels also need
        // a matching target, even when the action word itself matches.
        if (((form.family && sameHeadIntents.size > 1) || ['create_component','document_watch'].includes(record.intent)) &&
            form.argument !== learned.argument) return;
        if (form.family && form.head === learned.head) {
          var common = 0;
          query.forEach(function(v){if(entry.features.has(v)) common++;});
          score = 0.5 + 0.49 * common / Math.sqrt(query.size * entry.features.size);
        } else {
          // Free-form examples and different verbs require strong lexical
          // evidence. Exclude the opening word from those confirmatory clues.
          var matches = 0;
          form.content.forEach(function(v){if(learned.content.has(v)) matches++;});
          var overlap = matches / Math.sqrt(form.content.size * learned.content.size);
          var targetHints = {
            search:/^(?:dates?|passages?|dossiers?|notes?|articles?|informations?|releves?|donnees?|documents?|renseignements?)$/,
            tell:/^(?:comment|pourquoi|combien|methode|maniere)$/,
            save:/^(?:observations?|resultats?|releves?|mesures?|informations?|notes?|donnees?)$/,
            modify:/^(?:limites?|parametres?|durees?|longueurs?|nombres?|reglages?)$/,
            correct:/^(?:reponses?|valeurs?|titres?|erreurs?|textes?)$/,
            document_watch:/^veille$/
          };
          var hint = targetHints[record.intent];
          var queryWords = words(text);
          if (hint && familyIntents.size === 1 && form.family && form.family === learned.family &&
              (record.intent === 'tell' ? queryWords.some(function (word) { return hint.test(word); }) :
                Array.from(form.content).some(function (word) { return hint.test(word); }))) {
            score = 0.68 + overlap * 0.2;
          } else {
            if (matches < 2 || overlap < 0.70) return;
            score = 0.94 * overlap;
          }
        }
      }
      var prior = best.get(record.intent);
      if (!prior || score > prior.score || (score === prior.score && record.id.localeCompare(prior.id) < 0))
        best.set(record.intent, {intent:record.intent, score:score, id:record.id});
    });
    var candidates = Array.from(best.values()).sort(function(a,b){return b.score-a.score || a.id.localeCompare(b.id);});
    var first = candidates[0], rival = candidates[1];
    var accepted = !!first && (first.score === 1 || !rival || first.score-rival.score >= 0.10) && first.intent !== 'unknown';
    return {intent:accepted ? first.intent : null, candidate:first ? first.intent : null, score:first ? first.score : 0, accepted:accepted,
      reason:accepted ? 'Correspondance avec une consigne validée.' : 'Demande ambiguë, inconnue ou hors périmètre.',
      evidence:first ? first.id : null};
  }
  function predict(corpus, text, workId) {
    var index = buildIndex(validate(corpus).records);
    if (workId === undefined) {
      // Legacy callers without an argument referred to their only Work.
      var scopes = new Set(index.map(function(e){return e.record.workId;}).filter(Boolean));
      workId = scopes.size === 1 ? scopes.values().next().value : '';
    }
    return predictFrom(index, text, workId);
  }
  function evaluate(corpus) {
    var records = validate(corpus).records, index = buildIndex(records), seen = new Set(), results = [], excluded = [];
    records.filter(function(r){return r.split==='test';}).forEach(function(r) {
      var textKey = key(r.text), scope = JSON.stringify([r.workId,textKey]);
      var overlap = index.some(function(entry) {
        return entry.key === textKey && sameScope(entry.record,r.workId);
      });
      if (overlap || seen.has(scope)) {
        excluded.push({id:r.id, reason:overlap ? 'présent dans l’entraînement' : 'contrôle en double'});
        return;
      }
      seen.add(scope);
      var p = predictFrom(index,r.text,r.workId);
      results.push({id:r.id,text:r.text,workId:r.workId,expected:r.intent,predicted:p.intent,
        correct:p.intent===(r.intent==='unknown'?null:r.intent),score:p.score,evidence:p.evidence || null});
    });
    return {correct:results.filter(function(r){return r.correct;}).length,total:results.length,results:results,excluded:excluded};
  }
  return Object.freeze({SCHEMA:SCHEMA, TRANSFER_SCHEMA:TRANSFER_SCHEMA, INTENTS:INTENTS, empty:empty,
    validate:validate, merge:merge, predict:predict, evaluate:evaluate, planTransfer:planTransfer});
}));
