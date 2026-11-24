'use strict';
const assert = require('node:assert/strict');
const api = require('./work-language.js');
const intents = ['save','modify','tell','search','correct','create_component','document_watch'];
const verbs = ['Enregistre','Modifie','Dis-moi','Cherche','Corrige','Crée une composante','Lance la veille documentaire'];
const corpus = {schema:api.SCHEMA,records:intents.map((intent,i)=>({id:'train-'+i,text:verbs[i]+' le résultat du Work',intent,workId:'test',source:'user_correction',createdAt:'2026-01-01T00:00:00Z',split:'train'}))};
assert.equal(api.merge(corpus,corpus).records.length,7);
assert.throws(()=>api.merge(corpus,{schema:api.SCHEMA,records:[{...corpus.records[0],id:'conflict',intent:'search'}]}),/contradictoires/);
assert.throws(()=>api.validate({schema:api.SCHEMA,records:[{...corpus.records[0],source:'unverified'}]}),/Source/);
assert.equal(api.predict(corpus,'quantique thermodynamique').accepted,false);
for(let i=0;i<1000;i++) {
  const phrase=verbs[i%7]+' le résultat du Work '+(i+1);
  const r=api.predict(corpus,phrase);
  assert.equal(r.intent,intents[i%7],phrase);
}
const tests={schema:api.SCHEMA,records:[{...corpus.records[0],id:'heldout',text:'Enregistre le résultat de ce Work',split:'test'}]};
const joined=api.merge(corpus,tests);
assert.deepEqual([api.evaluate(joined).correct,api.evaluate(joined).total],[1,1]);
assert.equal(api.predict(tests,'Enregistre le résultat de ce Work').accepted,false);
console.log('1000 consignes, conflits, provenance et contrôle réservé : OK');
