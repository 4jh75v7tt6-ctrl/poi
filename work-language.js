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
      if (texts.has(k) && texts.get(k) !== r.intent) throw Error('Corrections contradictoires : ' + r.text);
      ids.add(r.id); texts.set(k,r.intent); return r;
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
      return {record:r, features:features(r.text), key:key(r.text)};
    });
  }

  function predictFrom(index, text, workId) {
    var query = features(text);
    if (!query.size) return {intent:null, accepted:false, score:0, reason:'Consigne sans caractéristiques utiles.'};
    var best = new Map();
    index.forEach(function (entry) {
      var record = entry.record;
      if (workId && record.workId && record.workId !== workId) return;
      var common = 0;
      query.forEach(function(v){if(entry.features.has(v)) common++;});
      if (!common) return;
      var score = common / Math.sqrt(query.size * entry.features.size);
      var prior = best.get(record.intent);
      if (!prior || score > prior.score || (score === prior.score && record.id.localeCompare(prior.id) < 0))
        best.set(record.intent, {intent:record.intent, score:score, id:record.id});
    });
    var candidates = Array.from(best.values()).sort(function(a,b){return b.score-a.score || a.id.localeCompare(b.id);});
    var first = candidates[0], rival = candidates[1];
    var accepted = !!first && first.score >= 0.46 && (!rival || first.score-rival.score >= 0.10) && first.intent !== 'unknown';
    return {intent:accepted ? first.intent : null, candidate:first ? first.intent : null, score:first ? first.score : 0, accepted:accepted,
      reason:accepted ? 'Correspondance avec une consigne validée.' : 'Demande ambiguë, inconnue ou hors périmètre.',
      evidence:first ? first.id : null};
  }
  function predict(corpus, text, workId) {
    return predictFrom(buildIndex(validate(corpus).records), text, workId);
  }
  function evaluate(corpus) {
    var records = validate(corpus).records, index = buildIndex(records), seen = new Set(), results = [], excluded = [];
    records.filter(function(r){return r.split==='test';}).forEach(function(r) {
      var textKey = key(r.text), scope = JSON.stringify([r.workId,textKey]);
      var overlap = index.some(function(entry) {
        return entry.key === textKey && (!entry.record.workId || !r.workId || entry.record.workId === r.workId);
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
