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
    return Object.assign({}, r);
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
  function predict(corpus, text) {
    var records = validate(corpus).records.filter(function(r){return r.split === 'train';}), query = features(text), candidates = [];
    if (!query.size) return {intent:null, accepted:false, reason:'Consigne sans caractéristiques utiles.'};
    records.forEach(function(r){
      var f = features(r.text), common = 0;
      query.forEach(function(v){if(f.has(v)) common++;});
      var score = common / Math.sqrt(query.size * f.size);
      if (score) candidates.push({intent:r.intent, score:score, id:r.id});
    });
    candidates.sort(function(a,b){return b.score-a.score || a.id.localeCompare(b.id);});
    var first = candidates[0], rival = candidates.find(function(c){return first && c.intent !== first.intent;});
    var accepted = !!first && first.score >= 0.46 && (!rival || first.score-rival.score >= 0.10) && first.intent !== 'unknown';
    return {intent:accepted ? first.intent : null, candidate:first ? first.intent : null, score:first ? first.score : 0, accepted:accepted,
      reason:accepted ? 'Correspondance avec une consigne validée.' : 'Demande ambiguë, inconnue ou hors périmètre ; demander une précision.', evidence:first ? first.id : null};
  }
  function evaluate(corpus) {
    var c = validate(corpus), tests = c.records.filter(function(r){return r.split==='test';});
    var results = tests.map(function(r){var p=predict(c,r.text); return {id:r.id,expected:r.intent,predicted:p.intent,correct:p.intent===(r.intent==='unknown'?null:r.intent),score:p.score};});
    return {correct:results.filter(function(r){return r.correct;}).length,total:results.length,results:results};
  }
  return Object.freeze({SCHEMA:SCHEMA, INTENTS:INTENTS, empty:empty, validate:validate, merge:merge, predict:predict, evaluate:evaluate});
}));
