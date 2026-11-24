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
const stamp = '2026-01-02T00:00:00Z';
const transfer = {schema:api.TRANSFER_SCHEMA,workId:'test',proposals:[
  {id:'seed',text:corpus.records[0].text,intent:'save',split:'train',origin:'practice_template'},
  {id:'export',text:'Garde la mesure du Work',intent:'save',split:'train',origin:'github_user_example'},
  {id:'control',text:'Garde la mesure du jour',intent:'save',split:'test',origin:'practice_template'}
]};
const plan = api.planTransfer(corpus,transfer,'',stamp);
assert.equal(plan.existing,1);
assert.equal(plan.added.length,2);
assert.equal(plan.corpus.records.length,9);
assert.equal(corpus.records.length,7);
assert.equal(plan.added[0].source,'user_label');
assert.match(plan.added[0].id,/^github\./);
assert.match(plan.added[1].id,/^practice\./);
assert.deepEqual(api.planTransfer(plan.corpus,transfer,'','2026-01-03T00:00:00Z').corpus,plan.corpus);
assert.equal(api.evaluate(plan.corpus).correct,1);
const overlap = {...transfer,proposals:[{...transfer.proposals[0],split:'test'}]};
assert.throws(()=>api.planTransfer(corpus,overlap,'',stamp),/autre usage/);
const duplicate = {...corpus.records[0],id:'legacy-leak',split:'test'};
const legacy = api.merge(corpus,{schema:api.SCHEMA,records:[duplicate]});
assert.equal(api.evaluate(legacy).total,0);
assert.equal(api.evaluate(legacy).excluded[0].id,'legacy-leak');
assert.throws(()=>api.planTransfer(corpus,{...transfer,proposals:[transfer.proposals[2],{...transfer.proposals[2],intent:'modify'}]},'',stamp),/contradictoire/);
assert.throws(()=>api.merge(corpus, transfer),/Format de corpus/);
assert.equal(api.predict(corpus,corpus.records[0].text,'another-work').accepted,false);
console.log('Transfert, conservation de la correction initiale, répétition, portée et contrôle indépendant : OK');
