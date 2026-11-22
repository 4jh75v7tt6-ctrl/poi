/* POI — local document reading. Imported content is data, never instructions or code. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.POIDocuments = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  var VERSION = '1.1.0';
  var LIMITS = Object.freeze({ fileBytes: 8 * 1024 * 1024, documents: 6, totalBytes: 12 * 1024 * 1024, textCharacters: 1200000, pdfPages: 200, ocrPages: 3, imagePixels: 24000000, imageSide: 1800, zipEntries: 512, zipExpandedBytes: 24 * 1024 * 1024, xmlBytes: 3 * 1024 * 1024, answerCharacters: 16000 });
  var isNode = typeof process === 'object' && process.versions && process.versions.node && typeof require === 'function';
  var scriptURL = !isNode && typeof document !== 'undefined' && document.currentScript && document.currentScript.src;
  var baseURL = isNode ? require('node:url').pathToFileURL(__dirname + '/').href : new URL('./', scriptURL || root.location.href).href;
  var scripts = Object.create(null), pdfPromise = null, resourcesPromise = null, verified = new WeakMap();
  var METHODS = ['text','html','docx','pdf-text','pdf-text+ocr','ocr','none'];
  var MIMES = { text: ['text/plain','text/markdown','text/csv','application/json','text/html'], pdf:['application/pdf'], docx:['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], image:['image/png','image/jpeg','image/webp'] };
  function textLimitLabel(){return LIMITS.textCharacters.toLocaleString('fr-FR').replace(/[\u00a0\u202f]/g,' ');}
  function asset(path) { return new URL(path, baseURL).href; }
  function fail(message) { throw new Error(message); }
  function abortError() { var error = new Error('Import annulé.'); error.name = 'AbortError'; return error; }
  function checkAbort(signal) { if (signal && signal.aborted) throw abortError(); }
  function notify(options, stage, message, progress) {
    if (options && typeof options.onProgress === 'function') {
      var entry = {stage:stage,message:message};
      if (typeof progress === 'number' && Number.isFinite(progress)) entry.progress = Math.max(0,Math.min(1,progress));
      options.onProgress(entry);
    }
  }
  function withAbort(promise, signal, cleanup) {
    if (!signal) return promise;
    if (signal.aborted) { Promise.resolve(promise).then(function (value) { if(cleanup) cleanup(value); },function(){}); return Promise.reject(abortError()); }
    return new Promise(function (resolve,reject) {
      var aborted=false;
      function onAbort() { aborted=true; reject(abortError()); }
      signal.addEventListener('abort',onAbort,{once:true});
      Promise.resolve(promise).then(function(value){signal.removeEventListener('abort',onAbort); if(aborted){if(cleanup)cleanup(value);}else resolve(value);},function(error){signal.removeEventListener('abort',onAbort);if(!aborted)reject(error);});
    });
  }
  function delay() { return new Promise(function(resolve){setTimeout(resolve,0);}); }
  function bytesToBase64(bytes) {
    if (isNode) return Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength).toString('base64');
    var parts=[];for(var i=0;i<bytes.length;i+=16384)parts.push(String.fromCharCode.apply(null,bytes.subarray(i,i+16384)));
    return btoa(parts.join(''));
  }
  function base64Length(value) {
    if(typeof value!=='string'||value.length%4!==0||value.length>Math.ceil(LIMITS.fileBytes/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))fail('Données originales encodées invalides.');
    return value.length/4*3-(value.endsWith('==')?2:value.endsWith('=')?1:0);
  }
  function decodeBase64(value) {
    var length=base64Length(value);
    if(isNode){var b=Buffer.from(value,'base64');if(b.length!==length)fail('Encodage original incohérent.');return new Uint8Array(b);}
    var s=atob(value),out=new Uint8Array(s.length);for(var i=0;i<s.length;i++)out[i]=s.charCodeAt(i);return out;
  }
  // Standard SHA-256, used for integrity checks on restored originals. Successful checks are cached per immutable payload.
  function sha256(bytes) {
    var k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    var h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],w=new Uint32Array(64);
    var padded=new Uint8Array(Math.ceil((bytes.length+9)/64)*64);padded.set(bytes);padded[bytes.length]=128;
    var view=new DataView(padded.buffer);view.setUint32(padded.length-8,Math.floor(bytes.length/0x20000000));view.setUint32(padded.length-4,(bytes.length*8)>>>0);
    function r(v,n){return(v>>>n)|(v<<(32-n));}
    for(var pos=0;pos<padded.length;pos+=64){
      for(var t=0;t<16;t++)w[t]=view.getUint32(pos+t*4);
      for(t=16;t<64;t++){var s0=r(w[t-15],7)^r(w[t-15],18)^(w[t-15]>>>3),s1=r(w[t-2],17)^r(w[t-2],19)^(w[t-2]>>>10);w[t]=(w[t-16]+s0+w[t-7]+s1)>>>0;}
      var a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7];
      for(t=0;t<64;t++){var q1=(hh+(r(e,6)^r(e,11)^r(e,25))+((e&f)^((~e)&g))+k[t]+w[t])>>>0,q2=((r(a,2)^r(a,13)^r(a,22))+((a&b)^(a&c)^(b&c)))>>>0;hh=g;g=f;f=e;e=(d+q1)>>>0;d=c;c=b;b=a;a=(q1+q2)>>>0;}
      h[0]=(h[0]+a)>>>0;h[1]=(h[1]+b)>>>0;h[2]=(h[2]+c)>>>0;h[3]=(h[3]+d)>>>0;h[4]=(h[4]+e)>>>0;h[5]=(h[5]+f)>>>0;h[6]=(h[6]+g)>>>0;h[7]=(h[7]+hh)>>>0;
    }
    return h.map(function(n){return n.toString(16).padStart(8,'0');}).join('');
  }
  async function digest(bytes) { if(root.crypto&&root.crypto.subtle){var b=await root.crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(b),function(n){return n.toString(16).padStart(2,'0');}).join('');}return sha256(bytes); }
  function plain(value,label) { if(!value||typeof value!=='object'||Array.isArray(value))fail(label+' invalide.');var p=Object.getPrototypeOf(value);if(p!==Object.prototype&&p!==null)fail(label+' possède un prototype invalide.'); }
  function keys(value,allowed,label){plain(value,label);Object.keys(value).forEach(function(k){if(allowed.indexOf(k)<0)fail(label+' : champ inconnu '+k+'.');});}
  function string(value,label,max,empty){if(typeof value!=='string'||value.length>max||(!empty&&!value.trim()))fail(label+' invalide.');return value;}
  function integer(value,label,min,max){if(!Number.isInteger(value)||value<min||value>max)fail(label+' invalide.');return value;}
  function hasSignature(bytes,kind,mime){
    if(kind==='pdf'){var lead=new TextDecoder('latin1').decode(bytes.subarray(0,1024));return lead.indexOf('%PDF-')>=0;}
    if(kind==='docx')return bytes.length>=4&&bytes[0]===80&&bytes[1]===75&&bytes[2]===3&&bytes[3]===4;
    if(kind==='image'){
      if(mime==='image/png')return bytes.length>=24&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10;
      if(mime==='image/jpeg')return bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
      if(mime==='image/webp')return bytes.length>=12&&String.fromCharCode.apply(null,bytes.subarray(0,4))==='RIFF'&&String.fromCharCode.apply(null,bytes.subarray(8,12))==='WEBP';
    }
    return kind==='text';
  }
  function imageDimensions(bytes,mime){
    var v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),pos=0;
    if(mime==='image/png'&&bytes.length>=24&&String.fromCharCode.apply(null,bytes.subarray(12,16))==='IHDR')return{width:v.getUint32(16),height:v.getUint32(20)};
    if(mime==='image/jpeg'){
      pos=2;while(pos+3<bytes.length){if(bytes[pos++]!==255)return null;while(bytes[pos]===255)pos++;var marker=bytes[pos++];if(marker===0xda||marker===0xd9)break;if(marker===0xd8||marker===1||marker>=0xd0&&marker<=0xd7)continue;if(pos+2>bytes.length)return null;var size=v.getUint16(pos);if(size<2||pos+size>bytes.length)return null;if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].indexOf(marker)>=0&&size>=7)return{width:v.getUint16(pos+5),height:v.getUint16(pos+3)};pos+=size;}
    }
    if(mime==='image/webp'){
      pos=12;while(pos+8<=bytes.length){var kind=String.fromCharCode.apply(null,bytes.subarray(pos,pos+4)),length=v.getUint32(pos+4,true),start=pos+8;if(start+length>bytes.length)return null;
        if(kind==='VP8X'&&length>=10)return{width:1+bytes[start+4]+(bytes[start+5]<<8)+(bytes[start+6]<<16),height:1+bytes[start+7]+(bytes[start+8]<<8)+(bytes[start+9]<<16)};
        if(kind==='VP8 '&&length>=10&&bytes[start+3]===157&&bytes[start+4]===1&&bytes[start+5]===42)return{width:v.getUint16(start+6,true)&16383,height:v.getUint16(start+8,true)&16383};
        if(kind==='VP8L'&&length>=5&&bytes[start]===47){var bits=v.getUint32(start+1,true);return{width:(bits&16383)+1,height:((bits>>>14)&16383)+1};}
        pos=start+length+(length%2);
      }
    }
    return null;
  }
  function checkImageSize(bytes,mime){var dimensions=imageDimensions(bytes,mime);if(!dimensions||!dimensions.width||!dimensions.height)fail('Dimensions de l’image illisibles. Utilisez un PNG, JPEG ou WebP valide.');if(dimensions.width*dimensions.height>LIMITS.imagePixels)fail('Image trop grande : limitez-la à 24 mégapixels avant de la joindre.');return dimensions;}
  function validateDocuments(value) {
    if(!Array.isArray(value)||value.length>LIMITS.documents)fail('Au maximum six documents peuvent être conservés.');
    var total=0,seen=new Set();
    return value.map(function(doc){
      keys(doc,['id','name','mime','size','addedAt','kind','sha256','dataBase64','pages','extraction'],'Document');
      var name=string(doc.name,'Nom du document',180,false);if(/[\x00-\x1f\\/]/.test(name))fail('Nom de document non autorisé.');
      if(!Object.prototype.hasOwnProperty.call(MIMES,doc.kind)||MIMES[doc.kind].indexOf(doc.mime)<0)fail('Type de document non pris en charge.');
      var size=integer(doc.size,'Taille du document',1,LIMITS.fileBytes);total+=size;if(total>LIMITS.totalBytes)fail('Les originaux joints dépassent 12 Mio au total.');
      var hash=string(doc.sha256,'Empreinte du document',64,false);if(!/^[a-f0-9]{64}$/.test(hash)||doc.id!=='doc-'+hash.slice(0,24))fail('Identifiant ou empreinte du document incohérent.');
      if(seen.has(doc.id))fail('Ce document est déjà présent.');seen.add(doc.id);
      var time=string(doc.addedAt,'Date d’ajout',40,false);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(time)||!Number.isFinite(Date.parse(time)))fail('Date d’ajout invalide.');
      if(base64Length(doc.dataBase64)!==size)fail('La taille de l’original ne correspond pas à ses données.');
      var cached=verified.get(doc),entry;
      if(!cached||cached.payload!==doc.dataBase64||cached.hash!==hash||cached.kind!==doc.kind||cached.mime!==doc.mime){var bytes=decodeBase64(doc.dataBase64);if(sha256(bytes)!==hash)fail('L’empreinte SHA-256 ne correspond pas au document original.');if(!hasSignature(bytes,doc.kind,doc.mime))fail('Le contenu original ne correspond pas au format déclaré.');if(doc.kind==='image')checkImageSize(bytes,doc.mime);entry={payload:doc.dataBase64,hash:hash,kind:doc.kind,mime:doc.mime};verified.set(doc,entry);}else entry=cached;
      keys(doc.extraction,['method','totalPages','processedPages','truncated','warnings','ocrDurationMs'],'Extraction');var ex=doc.extraction;
      if(METHODS.indexOf(ex.method)<0)fail('Méthode d’extraction inconnue.');
      var methodsForKind={text:['text','html'],docx:['docx'],pdf:['pdf-text','pdf-text+ocr'],image:['ocr','none']};
      if(methodsForKind[doc.kind].indexOf(ex.method)<0)fail('La méthode d’extraction ne correspond pas au format.');
      var totalPages=integer(ex.totalPages,'Nombre de pages ou sections',1,1000000),processed=integer(ex.processedPages,'Pages traitées',0,Math.min(totalPages,LIMITS.pdfPages));
      if(typeof ex.truncated!=='boolean'||!Array.isArray(ex.warnings)||ex.warnings.length>20)fail('Limites d’extraction invalides.');
      var warnings=ex.warnings.map(function(w){return string(w,'Avertissement',1000,false);});
      if(!Array.isArray(doc.pages)||doc.pages.length>LIMITS.pdfPages)fail('Nombre d’extraits invalide.');
      var chars=0,last=0,pages=doc.pages.map(function(page){keys(page,['number','text'],'Page');var num=integer(page.number,'Numéro de page',1,totalPages);if(num<=last)fail('Les pages doivent être uniques et ordonnées.');last=num;var t=string(page.text,'Texte extrait',LIMITS.textCharacters,true);chars+=t.length;if(chars>LIMITS.textCharacters)fail('Le texte extrait dépasse '+textLimitLabel()+' caractères.');return {number:num,text:t};});
      if(pages.length>processed||last>processed)fail('Le nombre d’extraits dépasse les pages traitées.');
      if(processed<totalPages&&!ex.truncated)fail('Une lecture incomplète doit être signalée comme partielle.');
      var clean={id:doc.id,name:name,mime:doc.mime,size:size,addedAt:time,kind:doc.kind,sha256:hash,dataBase64:doc.dataBase64,pages:pages,extraction:{method:ex.method,totalPages:totalPages,processedPages:processed,truncated:ex.truncated,warnings:warnings}};
      if(ex.ocrDurationMs!==undefined){if(typeof ex.ocrDurationMs!=='number'||!Number.isFinite(ex.ocrDurationMs)||ex.ocrDurationMs<0)fail('Durée OCR invalide.');clean.extraction.ocrDurationMs=ex.ocrDurationMs;}
      verified.set(clean,entry);return clean;
    });
  }
  function documentBlob(doc){return new Blob([decodeBase64(doc.dataBase64)],{type:doc.mime});}
  function cleanText(text){return String(text).replace(/\u0000/g,'').replace(/\r\n?/g,'\n').replace(/[\t ]+\n/g,'\n').replace(/\n{4,}/g,'\n\n\n').trim();}
  function decodeText(bytes){
    var encoding='utf-8';if(bytes[0]===255&&bytes[1]===254)encoding='utf-16le';else if(bytes[0]===254&&bytes[1]===255)encoding='utf-16be';
    var t;try{t=new TextDecoder(encoding,{fatal:true}).decode(bytes);}catch(_){t=new TextDecoder('windows-1252').decode(bytes);}
    if(encoding==='utf-8'&&/\u0000/.test(t))fail('Ce fichier semble binaire ; exportez-le en texte, PDF ou DOCX.');
    return t;
  }
  function entities(value){return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,function(all,key){var lower=key.toLowerCase();if(lower[0]==='#'){var n=lower[1]==='x'?parseInt(lower.slice(2),16):parseInt(lower.slice(1),10);return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'�';}return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[lower];});}
  function htmlText(html){
    return cleanText(entities(String(html).replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|template|noscript|svg|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<(br|hr)\b[^>]*>/gi,'\n').replace(/<\/(p|div|section|article|h[1-6]|li|tr|blockquote)\s*>/gi,'\n\n').replace(/<[^>]+>/g,' ')));
  }
  function textSections(text,method,warnings){
    var value=cleanText(text),truncated=value.length>LIMITS.textCharacters;
    if(truncated){value=value.slice(0,LIMITS.textCharacters);warnings.push('Le texte extrait est limité aux '+textLimitLabel()+' premiers caractères ; l’original complet reste conservé.');}
    var pages=[],pos=0;while(pos<value.length){var end=Math.min(value.length,pos+20000);if(end<value.length){var boundary=value.lastIndexOf('\n',end);if(boundary>pos+10000)end=boundary+1;}pages.push({number:pages.length+1,text:value.slice(pos,end)});pos=end;}
    if(!pages.length)pages.push({number:1,text:''});
    warnings.push('Les numéros de ces extraits sont des sections de texte, pas les pages d’une édition imprimée.');
    return {pages:pages,extraction:{method:method,totalPages:pages.length,processedPages:pages.length,truncated:truncated,warnings:warnings}};
  }
  async function readAsset(path){
    if(isNode)return new Uint8Array(await require('node:fs/promises').readFile(new URL(asset(path))));
    var response=await fetch(asset(path),{credentials:'same-origin'});if(!response.ok||response.redirected||new URL(response.url).origin!==new URL(baseURL).origin)fail('Une ressource locale du lecteur est indisponible.');return new Uint8Array(await response.arrayBuffer());
  }
  function loadScript(path,globalName){
    if(root[globalName])return Promise.resolve(root[globalName]);
    if(isNode){if(globalName==='JSZip')return Promise.resolve(require('./vendor/jszip/jszip.min.js'));return Promise.reject(new Error('Le module OCR nécessite le navigateur.'));}
    if(!scripts[path])scripts[path]=new Promise(function(resolve,reject){var script=document.createElement('script');script.src=asset(path);script.onload=function(){root[globalName]?resolve(root[globalName]):reject(new Error('Module local absent après chargement.'));};script.onerror=function(){script.remove();delete scripts[path];reject(new Error('Ressource locale indisponible : ouvrez une première fois avec une connexion.'));};document.head.appendChild(script);});
    return scripts[path];
  }
  // Inspect central ZIP metadata before any document expansion. No encrypted/ZIP64/multidisk containers.
  function inspectZip(bytes){
    if(bytes.length<22)fail('Archive DOCX incomplète.');var view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),end=-1;
    for(var i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===bytes.length){end=i;break;}}
    if(end<0)fail('Structure ZIP du document invalide.');
    if(view.getUint16(end+4,true)!==0||view.getUint16(end+6,true)!==0)fail('Les archives multi-volumes ne sont pas prises en charge.');
    var count=view.getUint16(end+10,true),size=view.getUint32(end+12,true),offset=view.getUint32(end+16,true);
    if(count===65535||size===0xffffffff||offset===0xffffffff||count>LIMITS.zipEntries||offset+size>end)fail('Archive trop complexe ou ZIP64 non pris en charge.');
    var pos=offset,total=0,names=new Set(),entries=[];
    for(i=0;i<count;i++){
      if(pos+46>bytes.length||view.getUint32(pos,true)!==0x02014b50)fail('Répertoire ZIP invalide.');
      var flags=view.getUint16(pos+8,true),method=view.getUint16(pos+10,true),compressed=view.getUint32(pos+20,true),expanded=view.getUint32(pos+24,true),nameLength=view.getUint16(pos+28,true),extra=view.getUint16(pos+30,true),comment=view.getUint16(pos+32,true);
      if(flags&1||[0,8].indexOf(method)<0||expanded===0xffffffff||compressed===0xffffffff)fail('Archive chiffrée ou méthode de compression non prise en charge.');
      if(pos+46+nameLength+extra+comment>offset+size)fail('Entrée ZIP incomplète.');
      var name=new TextDecoder('utf-8').decode(bytes.subarray(pos+46,pos+46+nameLength));
      if(!name||name.startsWith('/')||name.indexOf('\\')>=0||name.split('/').indexOf('..')>=0||names.has(name)||/[\x00-\x1f]/.test(name))fail('Chemin de fichier DOCX non autorisé.');
      names.add(name);total+=expanded;
      if(total>LIMITS.zipExpandedBytes||expanded>LIMITS.zipExpandedBytes||(expanded>1048576&&expanded/Math.max(1,compressed)>250))fail('Expansion de l’archive trop importante pour cet appareil.');
      entries.push({name:name,size:expanded});pos+=46+nameLength+extra+comment;
    }
    if(pos!==offset+size)fail('Dimensions du répertoire ZIP incohérentes.');return entries;
  }
  function streamEntry(entry,limit,signal){
    checkAbort(signal);return new Promise(function(resolve,reject){var chunks=[],size=0,settled=false,stream=entry.internalStream('uint8array');
      function finish(error){if(settled)return;settled=true;if(signal)signal.removeEventListener('abort',cancel);stream.pause();if(error)reject(error);else{var result=new Uint8Array(size),offset=0;chunks.forEach(function(chunk){result.set(chunk,offset);offset+=chunk.length;});resolve(result);}}
      function cancel(){finish(abortError());}if(signal)signal.addEventListener('abort',cancel,{once:true});
      stream.on('data',function(chunk){if(settled)return;size+=chunk.length;if(size>limit){finish(new Error('Texte XML décompressé trop volumineux.'));return;}chunks.push(chunk);}).on('error',finish).on('end',function(){finish();}).resume();
    });
  }
  function wordXMLText(xml){
    if(/<!DOCTYPE|<!ENTITY/i.test(xml))fail('Les déclarations d’entités XML ne sont pas acceptées.');
    if(!/<(?:\w+:)?(?:document|footnotes|endnotes)\b/.test(xml))fail('Contenu Word XML non reconnu.');
    var source=xml.replace(/<(?:\w+:)?del\b[^>]*>[\s\S]*?<\/(?:\w+:)?del>/g,'');
    var parts=[],tokens=source.match(/<(?:\w+:)?t(?:\s[^>]*)?>[\s\S]*?<\/(?:\w+:)?t>|<(?:\w+:)?(?:tab|br|cr)\b[^>]*\/?>|<\/(?:\w+:)?(?:p|tr)>/g)||[];
    tokens.forEach(function(token){if(/^<\//.test(token))parts.push('\n');else if(/<(?:\w+:)?tab\b/.test(token))parts.push('\t');else if(/<(?:\w+:)?(?:br|cr)\b/.test(token))parts.push('\n');else parts.push(entities(token.replace(/^<[^>]*>/,'').replace(/<\/[^>]*>$/,'')));});
    return cleanText(parts.join(''));
  }
  async function parseDocx(bytes,options){
    notify(options,'parse','Lecture du texte Word…',0.2);var entries=inspectZip(bytes);
    if(!entries.some(function(e){return e.name==='word/document.xml';}))fail('Ce ZIP ne contient pas de document DOCX.');
    var wanted=['word/document.xml','word/footnotes.xml','word/endnotes.xml'];
    wanted.forEach(function(name){var e=entries.find(function(x){return x.name===name;});if(e&&e.size>LIMITS.xmlBytes)fail('Le texte Word décompressé dépasse la limite de 3 Mio.');});
    var JSZip=await withAbort(loadScript('vendor/jszip/jszip.min.js','JSZip'),options.signal);checkAbort(options.signal);
    var zip=await JSZip.loadAsync(bytes,{checkCRC32:false,createFolders:false}),texts=[];
    for(var i=0;i<wanted.length;i++){checkAbort(options.signal);var file=zip.file(wanted[i]);if(file){var raw=await streamEntry(file,LIMITS.xmlBytes,options.signal);var value=wordXMLText(new TextDecoder('utf-8',{fatal:true}).decode(raw));if(value)texts.push(i===0?value:'Notes du document\n'+value);}}
    return textSections(texts.join('\n\n'),'docx',['Extraction du texte principal et des notes. Images, tableaux complexes, commentaires et mise en page ne sont pas analysés.']);
  }
  async function resources(){if(!resourcesPromise)resourcesPromise=Promise.all([loadScript('vendor/jszip/jszip.min.js','JSZip'),readAsset('vendor/pdfjs/resources.zip')]).then(function(pair){return pair[0].loadAsync(pair[1]);}).catch(function(error){resourcesPromise=null;throw error;});return resourcesPromise;}
  // PDF.js 5.6 uses one BinaryDataFactory for CMaps, fonts and image codecs.
  function BinaryDataFactory(){}
  BinaryDataFactory.prototype.fetch=async function(options){
    if(!/^[A-Za-z0-9_.-]+$/.test(options.filename))fail('Nom de ressource PDF invalide.');
    if(options.kind==='wasmUrl')return readAsset('vendor/pdfjs/wasm/'+options.filename);
    var folder=options.kind==='cMapUrl'?'cmaps/':options.kind==='standardFontDataUrl'?'standard_fonts/':null;
    if(!folder)fail('Type de ressource PDF non autorisé.');
    var zip=await resources(),file=zip.file(folder+options.filename);if(!file)fail('Ressource PDF locale indisponible.');return file.async('uint8array');
  };
  function loadPDF(){if(!pdfPromise)pdfPromise=import(asset('vendor/pdfjs/pdf.min.mjs')).then(function(pdf){pdf.GlobalWorkerOptions.workerSrc=asset('vendor/pdfjs/pdf.worker.min.mjs');return pdf;}).catch(function(error){pdfPromise=null;throw error;});return pdfPromise;}
  function pushWarning(warnings,text){if(warnings.indexOf(text)<0&&warnings.length<20)warnings.push(text.slice(0,1000));}
  async function newOCR(options){
    checkAbort(options.signal);notify(options,'ocr-load','Chargement du lecteur de texte français local…');
    var Tesseract=await withAbort(loadScript('vendor/ocr/tesseract.min.js','Tesseract'),options.signal);checkAbort(options.signal);
    var pending=Tesseract.createWorker('fra',1,{workerPath:asset('vendor/ocr/worker.min.js'),corePath:asset('vendor/ocr/tesseract-core-lstm.wasm.js'),langPath:asset('vendor/ocr').replace(/\/$/,''),gzip:false,workerBlobURL:false,cacheMethod:'write',cachePath:'poi-ocr-fra-v1',logger:function(m){var message=m.status==='recognizing text'?'Reconnaissance du texte…':'Préparation du lecteur local…';notify(options,m.status==='recognizing text'?'ocr':'ocr-load',message,m.progress);}});
    var worker=await withAbort(pending,options.signal,function(w){w.terminate();});checkAbort(options.signal);return worker;
  }
  function ocrClock(){return root.performance&&typeof root.performance.now==='function'?root.performance.now():null;}
  function timedExtraction(extraction,timings){if(timings.measured)extraction.ocrDurationMs=timings.durationMs;return extraction;}
  async function recognize(worker,canvas,options,timings){
    checkAbort(options.signal);var timeout,abort;
    var failure=new Promise(function(_,reject){timeout=setTimeout(function(){worker.terminate();reject(new Error('Reconnaissance interrompue après 60 secondes.'));},60000);if(options.signal){abort=function(){worker.terminate();reject(abortError());};options.signal.addEventListener('abort',abort,{once:true});}});
    var started=ocrClock();
    try{var result=await Promise.race([worker.recognize(canvas,{}, {text:true}),failure]);checkAbort(options.signal);return cleanText(result.data&&result.data.text||'');}finally{var ended=ocrClock();if(timings&&started!==null&&ended!==null){timings.measured=true;timings.durationMs+=Math.max(0,ended-started);}clearTimeout(timeout);if(abort)options.signal.removeEventListener('abort',abort);}
  }
  function scaledCanvas(width,height){
    if(typeof document==='undefined')fail('Le rendu de l’image nécessite un navigateur.');
    if(!width||!height||width*height>LIMITS.imagePixels)fail('Image trop grande : limitez-la à 24 mégapixels.');
    var scale=Math.min(1,LIMITS.imageSide/Math.max(width,height),Math.sqrt(2500000/(width*height))),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));return canvas;
  }
  async function imageCanvas(bytes,mime,options){
    if(typeof Image==='undefined')fail('Le décodage d’image nécessite un navigateur.');checkAbort(options.signal);
    var url=URL.createObjectURL(new Blob([bytes],{type:mime})),image=new Image();
    try{await withAbort(new Promise(function(resolve,reject){image.onload=resolve;image.onerror=function(){reject(new Error('Cette image ne peut pas être décodée.'));};image.src=url;}),options.signal,function(){image.src='';});checkAbort(options.signal);var canvas=scaledCanvas(image.naturalWidth,image.naturalHeight);canvas.getContext('2d',{willReadFrequently:true}).drawImage(image,0,0,canvas.width,canvas.height);return canvas;}finally{URL.revokeObjectURL(url);}
  }
  async function parseImage(bytes,mime,options){
    var warnings=['Le lecteur extrait uniquement le texte visible. Il ne décrit pas les objets, les personnes ou la scène.','La reconnaissance optique peut contenir des erreurs ; vérifiez les passages dans l’original.'],worker=null,canvas=null,text='',method='none',timings={measured:false,durationMs:0};
    try{canvas=await imageCanvas(bytes,mime,options);notify(options,'parse','Image préparée pour la lecture locale.',0.25);worker=await newOCR(options);text=await recognize(worker,canvas,options,timings);method='ocr';if(!text)pushWarning(warnings,'Aucun texte lisible détecté dans cette image.');}
    catch(error){if(error.name==='AbortError')throw error;pushWarning(warnings,'Texte non extrait : '+error.message+' L’image originale est conservée.');}
    finally{if(worker)await worker.terminate().catch(function(){});if(canvas){canvas.width=0;canvas.height=0;}}
    var truncated=method==='none'||text.length>LIMITS.textCharacters;if(text.length>LIMITS.textCharacters){text=text.slice(0,LIMITS.textCharacters);pushWarning(warnings,'Le texte reconnu est limité à '+textLimitLabel()+' caractères.');}
    return {pages:[{number:1,text:text}],extraction:timedExtraction({method:method,totalPages:1,processedPages:1,truncated:truncated,warnings:warnings},timings)};
  }
  async function parsePDF(bytes,options){
    notify(options,'parse','Ouverture du PDF local…',0.1);var pdfjs=await withAbort(loadPDF(),options.signal);checkAbort(options.signal);
    var loading=pdfjs.getDocument({data:bytes.slice(),isEvalSupported:false,useWorkerFetch:false,BinaryDataFactory:BinaryDataFactory,cMapUrl:asset('vendor/pdfjs/cmaps/'),standardFontDataUrl:asset('vendor/pdfjs/standard_fonts/'),wasmUrl:asset('vendor/pdfjs/wasm/'),maxImageSize:LIMITS.imagePixels,canvasMaxAreaInBytes:10000000,disableAutoFetch:true,stopAtErrors:false,enableXfa:false});
    var pdf=null,worker=null,renderTask=null,pages=[],warnings=[],characters=0,ocrAttempts=0,ocrUsed=false,truncated=false,processed=0,timings={measured:false,durationMs:0};
    function cancel(){if(renderTask)renderTask.cancel();loading.destroy();if(worker)worker.terminate();}
    if(options.signal)options.signal.addEventListener('abort',cancel,{once:true});
    try{
      pdf=await withAbort(loading.promise,options.signal,function(p){p.destroy();});var total=pdf.numPages,maximum=Math.min(total,LIMITS.pdfPages);
      if(total>maximum){truncated=true;pushWarning(warnings,'Lecture limitée aux '+maximum+' premières pages sur '+total+'. L’original complet est conservé.');}
      for(var i=1;i<=maximum;i++){
        checkAbort(options.signal);notify(options,'parse','Lecture de la page '+i+' sur '+total+'…',0.15+0.7*(i/maximum));
        var page=await pdf.getPage(i),content=await page.getTextContent(),text=cleanText(content.items.map(function(item){return typeof item.str==='string'?item.str+(item.hasEOL?'\n':' '):'';}).join(''));
        if(text.replace(/\s/g,'').length<25){
          if(ocrAttempts<LIMITS.ocrPages&&typeof document!=='undefined'){
            ocrAttempts++;var canvas=null;
            try{
              if(!worker)worker=await newOCR(options);var initial=page.getViewport({scale:1}),scale=Math.min(2,LIMITS.imageSide/Math.max(initial.width,initial.height)),viewport=page.getViewport({scale:scale});canvas=scaledCanvas(viewport.width,viewport.height);
              renderTask=page.render({canvasContext:canvas.getContext('2d',{willReadFrequently:true}),viewport:page.getViewport({scale:scale*canvas.width/viewport.width})});await renderTask.promise;renderTask=null;
              var recognized=await recognize(worker,canvas,options,timings);if(recognized.length>text.length)text=recognized;ocrUsed=true;
            }catch(error){if(error.name==='AbortError'||options.signal&&options.signal.aborted)throw abortError();truncated=true;pushWarning(warnings,'OCR de la page '+i+' indisponible : '+error.message);if(worker){await worker.terminate().catch(function(){});worker=null;}}
            finally{if(canvas){canvas.width=0;canvas.height=0;}}
          }else{truncated=true;pushWarning(warnings,'Certaines pages contiennent peu de texte sélectionnable. L’OCR est limité à trois pages par PDF ; les autres images ne sont pas lues.');}
        }
        processed++;if(characters+text.length>LIMITS.textCharacters){text=text.slice(0,LIMITS.textCharacters-characters);truncated=true;pushWarning(warnings,'Texte extrait limité aux '+textLimitLabel()+' premiers caractères ; l’original complet est conservé.');}
        pages.push({number:i,text:text});characters+=text.length;page.cleanup();if(characters>=LIMITS.textCharacters){if(processed<total){truncated=true;pushWarning(warnings,'La limite de '+textLimitLabel()+' caractères est atteinte avant la fin du PDF ; les pages suivantes ne sont pas lues.');}break;}if(i%4===0)await delay();
      }
      if(ocrUsed)pushWarning(warnings,'Des passages proviennent de reconnaissance optique française ; vérifiez les citations dans l’original.');
      pushWarning(warnings,'L’ordre du texte peut différer de la mise en page, notamment avec des colonnes, tableaux ou formules.');
      return {pages:pages,extraction:timedExtraction({method:ocrUsed?'pdf-text+ocr':'pdf-text',totalPages:total,processedPages:processed,truncated:truncated,warnings:warnings},timings)};
    }catch(error){if(options.signal&&options.signal.aborted)throw abortError();if(error.name==='PasswordException')fail('Ce PDF est protégé par un mot de passe. Fournissez une copie déverrouillée.');throw error;}
    finally{if(options.signal)options.signal.removeEventListener('abort',cancel);if(worker)await worker.terminate().catch(function(){});await loading.destroy().catch(function(){});}
  }
  function fileType(name,mime){
    var ext=(name.split('.').pop()||'').toLowerCase();
    if(ext==='pdf'||mime==='application/pdf')return {kind:'pdf',mime:'application/pdf'};
    if(ext==='docx')return {kind:'docx',mime:MIMES.docx[0]};
    if(['png','jpg','jpeg','webp'].indexOf(ext)>=0||MIMES.image.indexOf(mime)>=0){var imageMime=ext==='png'?'image/png':ext==='webp'?'image/webp':ext==='jpg'||ext==='jpeg'?'image/jpeg':mime;return{kind:'image',mime:imageMime};}
    var textMime={txt:'text/plain',md:'text/markdown',markdown:'text/markdown',csv:'text/csv',json:'application/json',html:'text/html',htm:'text/html'};
    if(textMime[ext])return{kind:'text',mime:textMime[ext]};
    if(MIMES.text.indexOf(mime)>=0)return{kind:'text',mime:mime};
    fail('Format non pris en charge. Utilisez PDF, DOCX, TXT, Markdown, CSV, JSON, HTML, PNG, JPEG ou WebP.');
  }
  async function importFile(file,options){
    options=options||{};checkAbort(options.signal);
    if(!file||typeof file.arrayBuffer!=='function'||!Number.isInteger(file.size)||file.size<1)fail('Choisissez un fichier non vide.');
    if(file.size>LIMITS.fileBytes)fail('Ce fichier dépasse la limite de 8 Mio.');
    var name=String(file.name||'document.txt').split(/[\\/]/).pop().replace(/[\x00-\x1f]/g,' ').trim().slice(0,180);if(!name)fail('Le fichier doit avoir un nom.');
    var type=fileType(name,String(file.type||'').split(';')[0].toLowerCase());notify(options,'read','Lecture de « '+name+' » sur cet appareil…',0);
    var bytes=new Uint8Array(await withAbort(file.arrayBuffer(),options.signal));if(bytes.length!==file.size||bytes.length>LIMITS.fileBytes)fail('La taille du fichier a changé pendant la lecture.');
    if(!hasSignature(bytes,type.kind,type.mime))fail('Le contenu ne correspond pas au format du fichier.');
    if(type.kind==='image')checkImageSize(bytes,type.mime);
    checkAbort(options.signal);var hash=await digest(bytes),result;
    if(type.kind==='pdf')result=await parsePDF(bytes,options);else if(type.kind==='docx')result=await parseDocx(bytes,options);else if(type.kind==='image')result=await parseImage(bytes,type.mime,options);else{notify(options,'parse','Extraction du texte…',0.5);var t=decodeText(bytes),warnings=[];if(type.mime==='text/html'){t=htmlText(t);warnings.push('Le HTML a été converti en texte ; scripts, styles et contenus embarqués ne sont pas exécutés.');}result=textSections(t,type.mime==='text/html'?'html':'text',warnings);}
    checkAbort(options.signal);var doc={id:'doc-'+hash.slice(0,24),name:name,mime:type.mime,size:bytes.length,addedAt:new Date().toISOString(),kind:type.kind,sha256:hash,dataBase64:bytesToBase64(bytes),pages:result.pages,extraction:result.extraction};
    verified.set(doc,{payload:doc.dataBase64,hash:hash,kind:doc.kind,mime:doc.mime});doc=validateDocuments([doc])[0];notify(options,'finish','Document prêt. Original et texte conservés localement.',1);return doc;
  }

  // Retrieval never evaluates document text. Replies below contain exact source
  // spans or explicit, reproducible measurements, not generated literary claims.
  function normalize(value){return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/œ/g,'oe').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
  function unique(values){return Array.from(new Set(values));}
  var STOP=new Set(('a au aux avec ce ces cette cet de des du dans en et est es etre je tu il elle nous vous ils elles le la les un une d l j qu que qui quoi quel quelle quels quelles comment pourquoi pour par sur ton ta tes mon ma mes moi toi me te se s t n y on ou ne pas plus moins merci faire fait fais faitent sont ete etait etaient avoir avait avaient ont ai as avez avons serai sera serait son sa ses leur leurs nos vos notre votre ces celui celle ceux celles ceci cela ca dont entre comme mais donc or car ni ainsi alors encore aussi bien tres meme sans sous chez vers tout tous toute toutes autre autres chaque plusieurs seulement tant si lorsque quand apres avant ici la bas lequel laquelle auxquels auquel une fois parfois deja jamais toujours peut peux puis pourrez pourriez pouvez voudrais voudrait souhaite souhaites souhaiter aimerais veux veut voulons savoir connaitre donne donner donnerais dis dire dit montre montrer indique indiquer explique expliquer concernant propos parle parler information informations renseignement renseignements reponse repondre precise preciser exactement texte textes document documents fichier fichiers livre livres ouvrage ouvrages photo photos image images piece jointe pieces jointes selon apres auteur utilisateur cherche chercher recherche rechercher trouve trouver retrouve retrouver passage passages cite citer cites citation citations extrait extraits lire lis lecture lu lus lue lues resume resumer resumes analyse analyser etudie etudier etude etudes synthese fiche bref breve rapidement detail details detaille detailler contenu disponible disponibles mots mot terme termes notion definition definis definir signifie signifier veut appris apprendre retenu retiens').split(' '));
  ['lui','fut','quelque','quelques','celui','celle','ceux','celles'].forEach(function(word){STOP.add(word);});
  var ALIASES=Object.create(null);
  [
    ['depart','depart','departs','part','partent','partir','partira','partiront','parti','partie','departir'],
    ['contenir','contient','contiennent','contenir','contenait','contenaient','contiendra','stocke','stockee','stockees','stockes','stocker','stockage'],
    ['reserve','reserve','reserves','reservoir','reservoirs','cuve','cuves','citerne','citernes'],
    ['litre','litre','litres','liter','liters','litres'],
    ['eau','eau','eaux','water'],
    ['semer','seme','semee','semees','semes','semer','semis'],
    ['responsable','responsable','responsables','gere','gerer','gestionnaire'],
    ['situer','situe','situee','situes','situees','situer','localise','localisee','localises','localisees','localiser'],
    ['habiter','habite','habitent','habitait','habitaient','habiter','vit','vivent','vivait','reside','residait','resider'],
    ['ecrire','ecrit','ecrite','ecrites','ecrits','ecrire','redige','redigee','rediger'],
    ['nom','nom','noms','prenom','prenoms','appelle','appele','appelee','appelee','appelat','nomme','nommee','prenomme','prenommee'],
    ['profession','metier','metiers','profession','professions','professionnel','professionnelle']
  ].forEach(function(group){group.slice(1).forEach(function(word){ALIASES[word]=group[0];});});
  var PLURAL_EXCEPTIONS=new Set(['mars','paris','louis','thomas','temps','pays','corps','cours','sens','fils','fois','tous','plus','moins','apres','dans','sans','vers']);
  function canonical(word){if(ALIASES[word])return ALIASES[word];return word.length>4&&word.endsWith('s')&&!PLURAL_EXCEPTIONS.has(word)?word.slice(0,-1):word;}
  function words(value){return normalize(value).split(' ').filter(function(w){return w.length>=2&&w.length<=45&&!STOP.has(w);}).map(canonical);}
  function cite(item){return '['+item.name+', '+(item.kind==='pdf'?'p. ':item.kind==='image'?'image ': 'extrait ')+item.page+']';}
  function coverage(doc){var chars=doc.pages.reduce(function(n,p){return n+p.text.length;},0),readable=doc.pages.filter(function(p){return p.text.trim();}).length;return doc.name+' — '+chars.toLocaleString('fr-FR')+' caractères extraits ; '+readable+' '+(doc.kind==='pdf'?'pages':'sections')+' contenant du texte ; '+doc.extraction.processedPages+'/'+doc.extraction.totalPages+' unités traitées'+(doc.extraction.truncated?' ; lecture partielle':'')+'.';}

  var readerCache=new Map(),sentenceSegmenter=null;
  try{if(typeof Intl.Segmenter==='function')sentenceSegmenter=new Intl.Segmenter('fr',{granularity:'sentence'});}catch(_){}
  function sentenceSpans(text){
    var spans=sentenceSegmenter?Array.from(sentenceSegmenter.segment(text),function(part){return part.segment;}):text.match(/[^.!?…]+(?:[.!?…]+[»”"')\]]*(?:\s+|$)|$)/g)||[text],joined=[];
    spans.forEach(function(span){
      if(joined.length&&/\b(?:M|MM|Mme|Mmes|Mlle|Dr|Pr|St|Ste)\.\s*$/.test(joined[joined.length-1]))joined[joined.length-1]+=span;
      else joined.push(span);
    });
    return joined;
  }
  function sourceUnits(doc){
    var cached=readerCache.get(doc.id);
    if(cached&&cached.pages.length===doc.pages.length&&cached.pages.every(function(p,i){return p.number===doc.pages[i].number&&p.text===doc.pages[i].text;})){
      // Metadata can change independently of extracted text during a restoration.
      cached.records.forEach(function(r){r.name=doc.name;r.kind=doc.kind;});return cached;
    }
    var records=[],frequencies=new Map(),lexical=new Map(),allWords=0,sentences=0,questions=0,exclamations=0,pageText='',pageCursor=0;
    function append(text,page,fragment){
      text=text.trim();if(!text)return;
      var tokens=unique(words(text)),norm=normalize(text),all=norm?norm.split(' '):[];
      var start=pageText.indexOf(text,pageCursor);if(start<0)start=pageText.indexOf(text);pageCursor=Math.max(pageCursor,start+text.length);
      records.push({documentId:doc.id,name:doc.name,page:page,kind:doc.kind,excerpt:text,norm:norm,tokens:new Set(tokens),order:records.length,wordCount:all.length,fragment:fragment,start:start,end:start+text.length});
      tokens.forEach(function(token){frequencies.set(token,(frequencies.get(token)||0)+1);});
    }
    doc.pages.forEach(function(page){
      pageText=page.text;pageCursor=0;
      var letterWords=page.text.match(/[A-Za-zÀ-ÖØ-öø-ÿŒœ]+/g)||[];allWords+=letterWords.length;
      letterWords.forEach(function(word){var key=normalize(word);lexical.set(key,(lexical.get(key)||0)+1);});
      page.text.split(/\n[ \t]*\n+/).forEach(function(paragraph){
        sentenceSpans(paragraph).forEach(function(span){
          var text=span.trim();if(!text)return;
          // PDF heading lines are not fused into the following sentence.
          var newline=text.indexOf('\n');
          if(newline>0&&/^(?:.{0,90}\bpage\s+\d+|titre.{0,60}|chapitre.{0,60}|[IVXLC]+)\s*$/i.test(text.slice(0,newline))){
            append(text.slice(0,newline),page.number,true);text=text.slice(newline+1).trim();
          }
          if(/[.!?…][»”"')\]]*$/.test(text)){sentences++;if(/\?[»”"')\]]*$/.test(text))questions++;if(/![»”"')\]]*$/.test(text))exclamations++;}
          if(text.length<=1200){append(text,page.number,false);return;}
          // Long spans are bounded exact slices, never stitched into a new sentence.
          for(var offset=0;offset<text.length;){
            var end=Math.min(text.length,offset+1200);
            if(end<text.length){var space=text.lastIndexOf(' ',end);if(space>offset+600)end=space;}
            append(text.slice(offset,end),page.number,true);offset=end;
          }
        });
      });
    });
    var result={pages:doc.pages.map(function(p){return{number:p.number,text:p.text};}),records:records,frequencies:frequencies,lexical:lexical,wordCount:allWords,sentenceCount:sentences,questions:questions,exclamations:exclamations};
    if(readerCache.size>=6)readerCache.delete(readerCache.keys().next().value);
    readerCache.set(doc.id,result);return result;
  }
  function taskFor(query){
    var q=normalize(query);
    if(/\b(?:qu as tu appris|qu est ce que tu as appris|as tu appris|que retiens tu|qu as tu retenu|as tu retenu|qu apprend tu)\b/.test(q))return 'learning';
    if(/\b(?:cherche|chercher|recherche|rechercher|cite|citer|citation|citations|passage|passages|extraits)\b/.test(q)||/^(?:peux tu |pourrais tu )?(?:trouve|trouver)\b/.test(q))return 'search';
    if(/\b(?:definition|definis|definir|signifie|signifier|veut dire|qu est ce que|c est quoi|notion de)\b/.test(q))return 'definition';
    if(/\b(?:analyse|analyser|analyses|style|stylistique|lexical|lexicale|vocabulaire|statistiques|statistique|mots frequents|frequence|longueur des phrases|richesse lexicale)\b/.test(q))return 'analysis';
    if(/\b(?:resume|resumer|resumes|synthese|fiche de lecture|etudie|etudier|etude|lis ce|lis le|lis les|presente ce|de quoi parle)\b/.test(q)||/\bque contient (?:ce|le|cet) (?:livre|document|texte|ouvrage)\b/.test(q))return 'summary';
    return 'fact';
  }
  function factKind(query){
    var q=normalize(query);
    if(/\b(?:comment s appelle|comment se nomme|quel est le nom|quel nom|quel prenom|quelle est l identite)\b/.test(q))return 'name';
    if(/\b(?:metier|profession|travaille comme|quel travail|quelle fonction)\b/.test(q))return 'profession';
    if(/\b(?:combien|quantite|contenance|capacite|volume|montant|nombre|litres?)\b/.test(q))return 'quantity';
    if(/\b(?:quand|quelle date|a quelle heure|quel jour|quel mois|quelle annee|quel moment|horaire|date du|heure du)\b/.test(q))return 'when';
    if(/^(?:et )?(?:ou|d ou)|\b(?:quel lieu|quel endroit|quelle adresse|se situe|est situe|se trouve)\b/.test(q))return 'where';
    if(/^(?:et )?qui\b|\b(?:par qui|quel auteur|quelle personne)\b/.test(q))return 'who';
    if(/\bpourquoi\b/.test(q))return 'why';
    if(/\bcomment\b/.test(q))return 'how';
    return 'other';
  }
  function quantityProperty(query){var q=normalize(query);if(/\b(?:contenance|capacite|maximal|maximale|maximum|peut contenir)\b/.test(q))return 'capacity';if(/\b(?:quantite|contient|reste|restant|actuel|actuelle|actuellement|stocke)\b/.test(q))return 'current';return null;}
  function queryTerms(query,task){
    var kind=factKind(query),terms=words(query),ignore=new Set(['peux','voudrai','pourrai','quelque','besoin']);
    if(task==='fact'||task==='search'){
      ['quantite','contenance','capacite','volume','montant','nombre','combien','contenir','maximal','maximale','maximum','actuel','actuelle','actuellement'].forEach(function(w){ignore.add(w);});
      if(kind==='when')['date','heure','horaire','jour','moi','annee','moment','prevu','prevue'].forEach(function(w){ignore.add(w);});
      if(kind==='where')['lieu','endroit','adresse','situer','trouver'].forEach(function(w){ignore.add(w);});
      if(kind==='where'&&/\b(?:vit|habite|reside|demeure)\b/.test(normalize(query)))ignore.add('habiter');
      if(kind==='name')ignore.add('nom');
      if(kind==='profession')['profession','travail','fonction'].forEach(function(w){ignore.add(w);});
    }
    return unique(terms.filter(function(word){return !ignore.has(word);}));
  }
  function explicitDocumentQuery(q){return /\b(?:document|documents|fichier|fichiers|livre|livres|ouvrage|ouvrages|photo|photos|image|images|piece jointe|lecture|texte|textes)\b/.test(q);}
  function isQuestion(query){var q=normalize(query);return /[?？]/.test(query)||/^(?:et )?(?:qui|ou|quand|combien|quel|quelle|quels|quelles|comment|pourquoi|a quelle|d ou|qu est|que |peux tu|pourrais tu)/.test(q);}
  function followupContext(query,selected,context){
    var q=normalize(query),kind=factKind(query),ownTerms=queryTerms(query,'fact');
    if(!/^(?:et|ou|quand|combien|pourquoi)\b/.test(q)&&!/\b(?:elle|il|cela|celui ci|celle ci)\b/.test(q))return null;
    if(ownTerms.length>1&&!/\b(?:elle|il|cela|celui ci|celle ci)\b/.test(q))return null;
    var messages=context&&Array.isArray(context.messages)?context.messages.slice(-16):[],assistantIndex=-1;
    for(var i=messages.length-1;i>=0;i--){if(messages[i].role==='assistant'){assistantIndex=i;break;}}
    if(assistantIndex<0)return null;
    var previous=messages[assistantIndex],previousIds=Array.isArray(previous.documentIds)?previous.documentIds:[],ids=selected.filter(function(doc){return previousIds.indexOf(doc.id)>=0;}).map(function(doc){return doc.id;});
    if(previous.source!=='document'||!ids.length)return null;
    for(i=assistantIndex-1;i>=0;i--){if(messages[i].role==='user'){
      var terms=queryTerms(messages[i].text,'fact').filter(function(word){return ['depart','litre','heure','jour','semer'].indexOf(word)<0;});
      if(!terms.length)return null;
      return{terms:unique(ownTerms.concat(terms)),ids:ids,query:messages[i].text,kind:kind};
    }}
    return null;
  }
  function overlaps(a,b){var shared=0;a.forEach(function(word){if(b.has(word))shared++;});return shared/Math.max(1,Math.min(a.size,b.size));}
  function heading(item){return item.wordCount<4||/^(?:chapitre|partie|table des matieres|sommaire|titre|page \d|copyright|project gutenberg|gutenberg)/.test(item.norm)||/\bpage \d+$/.test(item.norm)&&item.wordCount<20;}
  function summaryChoices(index,maximum){
    var seen=new Set(),pool=index.records.filter(function(item){if(seen.has(item.norm))return false;seen.add(item.norm);return !heading(item)&&!item.fragment&&item.wordCount>=10&&item.wordCount<=42&&item.excerpt.length<=300;});
    if(pool.length<Math.min(maximum,index.records.length))pool=index.records.filter(function(item){return !heading(item)&&!item.fragment&&item.excerpt.length<=500;});
    if(!pool.length)pool=index.records.filter(function(item){return !heading(item);});
    if(!pool.length)pool=index.records.slice(0,maximum);
    function centrality(item){
      var sum=0;item.tokens.forEach(function(word){sum+=Math.log(1+(index.frequencies.get(word)||0));});
      var score=sum/Math.pow(Math.max(5,item.tokens.size),0.65);
      // A short, autonomous sentence is more useful than a long chain of clauses.
      score-=Math.max(0,item.wordCount-30)*0.07;
      if(/^(?:il|elle|ils|elles|on|ce|cela|puis|mais|et|enfin|ainsi|alors|pourtant)\b/.test(item.norm))score-=1.5;
      if(/^[—–«"]/.test(item.excerpt)||/[?!]$/.test(item.excerpt))score-=1.5;
      if(item.excerpt.endsWith(':'))score-=1.2;
      return score;
    }
    var scored=pool.map(function(item){return{item:item,score:centrality(item)};}),chosen=[];
    var zones=Math.min(maximum,scored.length);
    for(var zone=0;zone<zones;zone++){
      var lo=zone*index.records.length/zones,hi=(zone+1)*index.records.length/zones;
      var candidates=scored.filter(function(c){return c.item.order>=lo&&c.item.order<hi&&chosen.every(function(p){return overlaps(p.tokens,c.item.tokens)<0.84;});});
      candidates.sort(function(a,b){return b.score-a.score||a.item.order-b.item.order;});
      if(candidates.length)chosen.push(candidates[0].item);
    }
    scored.sort(function(a,b){return b.score-a.score||a.item.order-b.item.order;}).some(function(c){
      if(chosen.length>=maximum)return true;
      if(chosen.indexOf(c.item)<0&&chosen.every(function(p){return overlaps(p.tokens,c.item.tokens)<0.84;}))chosen.push(c.item);return false;
    });
    return chosen.sort(function(a,b){return a.order-b.order;});
  }
  function conditional(item){return /(?:^|[.!?]\s*)si\b|\b(?:pourrait|pourraient|serait|seraient|supposons|hypothese|hypothetique|eventuellement)\b/.test(item.norm);}
  function negative(item){return /\b(?:ne|n) .{0,65}\b(?:pas|jamais|aucun|aucune)\b|\b(?:aucun|aucune)\b/.test(item.norm);}
  function timeEvidence(item){return /\b\d{1,2}\s*(?:h(?:\s*\d{2})?|heures?)\b|\b\d{1,2}:\d{2}\b|\b(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|demain|matin|soir|midi|minuit)\b|\ben (?:1[5-9]|20)\d{2}\b/.test(item.norm);}
  function locationValue(item){
    var q=item.norm,match=q.match(/\b(?:se situe|se trouve|est situee?|etait situee?|est localisee?|se reunit|se reunissent|habite|habitait|reside|vivait|vit|demeure|a lieu|part|partira|depart|arrive|arrivera|est|etait)\s+(?:prevu\s+)?(?:a|au|aux|dans|devant|derriere|pres de|chez)\s+(.+)/);
    if(!match)match=q.match(/^(?:le |l )?(?:lieu|adresse)\s+(?:est\s+)?(.+)/);
    if(!match||/^(?:\d|l heure|la date|ce moment|l epoque|le matin|la soiree|l annee|le mois|midi|minuit)/.test(match[1]))return null;
    return match[1].split(/\b(?:et|mais|puis)\b/)[0].trim();
  }
  function personEvidence(item,query){
    var q=normalize(query);
    if(/^(?:et )?qui (?:est|etait)\b/.test(q))return /\b(?:est|etait|fut|nommee?|appelee?|responsable)\b/.test(item.norm);
    return /(?:^|[.!?]\s*)[«"“—–\s]*([A-ZÀ-ÖØ-Þ][a-zà-öø-ÿœ]+)(?:\s+[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿœ]+){0,2}\s+(?:est|etait|gere|gère|assure|organise|part|a |s['’]occupe)/.test(item.excerpt)&&!/^(?:Le|La|Les|Un|Une|Ce|Cette|Il|Elle)\b/.test(item.excerpt)||/\bpar\s+[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿœ]+/.test(item.excerpt);
  }
  function subjectSpan(item,terms){
    var tokens=item.norm.split(' '),positions=[];
    terms.forEach(function(term){var at=tokens.findIndex(function(word){return canonical(word)===term;});if(at>=0)positions.push(at);});
    if(positions.length!==terms.length)return null;
    var first=Math.min.apply(null,positions),last=Math.max.apply(null,positions);
    return{before:tokens.slice(0,first).join(' '),body:tokens.slice(first,last+1).join(' '),after:tokens.slice(last+1).join(' ')};
  }
  var PROFESSION='(?:ingenieur(?:e)?|medecin|officier de sante|pharmacien(?:ne)?|libraire|professeur(?:e)?|enseignant(?:e)?|instituteur|institutrice|avocat(?:e)?|notaire|architecte|artisan(?:e)?|agriculteur|agricultrice|cultivateur|cultivatrice|jardinier(?:e)?|peintre|ecrivain(?:e)?|auteur(?:e)?|journaliste|infirmier(?:e)?|commercant(?:e)?|boulanger(?:e)?|cuisinier(?:e)?|scientifique|chercheur|chercheuse|ouvrier(?:e)?|employe(?:e)?|technicien(?:ne)?|informaticien(?:ne)?|developpeur|developpeuse|directeur|directrice|comptable|secretaire|chauffeur|pilote|musicien(?:ne)?|chanteur|chanteuse|militaire|soldat|officier|pretre|cure|pasteur|religieu(?:x|se)|sage femme|dentiste|veterinaire|chirurgien(?:ne)?|biologiste|historien(?:ne)?)';
  var professionWord=new RegExp('\\b'+PROFESSION+'\\b');
  function professionEvidence(item,terms){
    var span=subjectSpan(item,terms);if(!span)return false;
    if(/\b(?:metier|profession|fonction) (?:de|d)$/.test(span.before)&&/^(?:est|etait)\b/.test(span.after)&&!/\b(?:inconnu|inconnue|ignore|ignorer|sait pas)\b/.test(span.after))return true;
    if(/^(?:exerce le metier de|exerce la profession de|travaille comme)\b/.test(span.after))return true;
    if(/\b(?:de|d)$/.test(span.before))return false;
    var after=new RegExp('^(?:(?:est|etait|fut|devient|devint|travaille comme|exerce comme) (?:un |une |le |la )?(?:jeune |ancien |ancienne |excellent |excellente )?)?'+PROFESSION+'\\b');
    return after.test(span.after)||new RegExp('\\b'+PROFESSION+'$').test(span.before);
  }
  function locationEvidence(item,terms,query){
    var span=subjectSpan(item,terms);if(!span||!locationValue(item)||/\b(?:de|d)$/.test(span.before))return false;
    if(/\b(?:vit|habite|habitait|reside|demeure)\b/.test(normalize(query)))return /^(?:vit|vivait|habite|habitait|reside|residait|demeure|demeurait|est installe(?:e)?)\s+(?:a|au|aux|dans|chez)\b/.test(span.after);
    return /^(?:se situe|se trouve|est situee?|etait situee?|est localisee?|se reunit|se reunissent|habite|habitait|reside|vivait|vit|demeure|a lieu|part|partira|depart|arrive|arrivera|est|etait)\s+(?:prevu\s+)?(?:a|au|aux|dans|devant|derriere|pres de|chez)\b/.test(span.after);
  }
  function nameEvidence(item,terms){
    var span=subjectSpan(item,terms);if(!span)return false;
    return /^(?:s appelle|se nomme|s appelait|se nommait|est nomme(?:e)?|etait nomme(?:e)?|est prenomme(?:e)?|nomme(?:e)?|prenomme(?:e)?|a pour nom|a pour prenom)\b/.test(span.after)||/\b(?:nom|prenom)\b.{0,35}\b(?:est|etait)\b/.test(item.norm)&&/\b(?:nom|prenom)\b/.test(span.before);
  }
  function relationConstraint(item,query){
    var target=normalize(query).match(/\b(fille|fils|mere|pere|frere|soeur|epouse|mari) (?:de|d) ([a-z]+)/);
    if(!target)return true;
    var explicit=new RegExp('\\b'+target[1]+' (?:de|d) ([a-z]+)','g'),match;
    while((match=explicit.exec(item.norm)))if(match[1]!==target[2])return false;
    return true;
  }
  function definitionEvidence(item,terms){
    if(!terms.length||item.fragment)return false;
    var q=item.norm;
    return terms.some(function(term){
      var offset=q.indexOf(term);if(offset<0)return false;
      var following=q.slice(offset+term.length,offset+term.length+100);
      if(/^\s+(?:designe|signifie|correspond a|se definit|consiste|represente)\b/.test(following))return true;
      if(/^\s+(?:est|sont)\s+(?:un|une|le|la|les|des|l)\b/.test(following)&&!/^\s+(?:est|sont)\s+(?:un|une|le|la|les|des|l)\s+(?:mot|terme)\s+(?:cite|mentionne)/.test(following))return true;
      return /\bon appelle\s*$/.test(q.slice(Math.max(0,offset-20),offset))||new RegExp('\\b'+term+'\\s*[:=]\\s*\\S','i').test(normalize(item.excerpt).replace(/ /g,' '))||new RegExp('\\b'+term+'\\s*:\\s*\\S','i').test(item.excerpt.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase());
    });
  }
  function numericalValue(item,kind){
    var q=item.excerpt.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[\u00a0\u202f]/g,' ');
    if(kind==='quantity'){var quantities=q.match(/\b\d+(?:[.,]\d+)?\s*(?:litres?|l\b|ml\b|euros?|kg\b|kilogrammes?|metres?|personnes?|places?|unites?)/g);return quantities?quantities.map(function(n){return n.replace(',','.');}).join('|'):null;}
    if(kind==='when'){var times=q.match(/\b\d{1,2}\s*(?:heures?|h(?:\s*\d{2})?)\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s+(?:janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?:\s+\d{4})?\b|\b(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/g);return times?times.join('|'):null;}
    if(kind==='where')return locationValue(item);
    return null;
  }
  function rankAnswers(corpus,terms,task,kind,query){
    if(!terms.length)return [];
    var frequency=new Map();terms.forEach(function(term){frequency.set(term,corpus.filter(function(item){return item.tokens.has(term);}).length);});
    var property=quantityProperty(query),ranked=[];
    corpus.forEach(function(item){
      // Every subject/constraint word must occur, after only explicit lexical variants.
      if(!terms.every(function(term){return item.tokens.has(term);}))return;
      if(task==='definition'&&!definitionEvidence(item,terms))return;
      if(task==='fact'){
        if(conditional(item)||negative(item)||!relationConstraint(item,query))return;
        if(kind==='profession'&&!professionEvidence(item,terms))return;
        if(kind==='name'&&!nameEvidence(item,terms))return;
        if(kind==='quantity'){
          if(!/\b\d+(?:[.,]\d+)?\b/.test(item.norm))return;
          var capacity=/\b(?:capacite|contenance|maximum|maximale?|peut contenir|peuvent contenir|jusqu a)\b/.test(item.norm);
          if(property==='capacity'&&!capacity||property==='current'&&capacity)return;
        }
        if(kind==='when'&&!timeEvidence(item))return;
        if(kind==='where'&&!locationEvidence(item,terms,query))return;
        if(kind==='who'&&!personEvidence(item,query))return;
        if(kind==='why'&&!/\b(?:parce que|car|puisque|en raison de|a cause de|grace a)\b/.test(item.norm))return;
        if(kind==='how'&&!/\b(?:pour|en utilisant|il faut|d abord|ensuite|puis|consiste|avec)\b/.test(item.norm))return;
      }
      var score=0;terms.forEach(function(term){score+=1+Math.log((corpus.length+1)/(1+frequency.get(term)));});
      score/=1+Math.max(0,item.wordCount-35)/100;if(item.fragment)score*=0.65;
      ranked.push({item:item,score:score});
    });
    return ranked.sort(function(a,b){return b.score-a.score||a.item.order-b.item.order;});
  }
  function contextualPassages(indices,terms,kind,query){
    if(!terms.length||['profession','name','where'].indexOf(kind)<0)return [];
    var ranked=[],nameGroups=query.match(/[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿœ]+(?:[ \t]+[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿœ]+)+/g)||[];
    indices.forEach(function(index){
      var localTerms=terms.slice();
      // A shorter name is considered only in an explicitly uncertain context,
      // and only when its full spelling is actually attested in this document.
      nameGroups.forEach(function(group){
        if(index.records.some(function(item){return item.norm.includes(normalize(group));})){
          words(group).slice(1).forEach(function(term){localTerms=localTerms.filter(function(t){return t!==term;});});
        }
      });
      index.records.forEach(function(anchor){
        if(anchor.fragment||!relationConstraint(anchor,query))return;
        var cue=kind==='profession'?professionWord.test(anchor.norm):kind==='name'?/\b(?:s appelle|se nomme|nommee?|prenommee?|appelee?|nom.{0,25}choisi|prenom.{0,25}choisi)\b/.test(anchor.norm):locationValue(anchor);
        if(!cue)return;
        if(kind==='profession'){
          var owner=anchor.norm.match(/\b(?:metier|profession|fonction) (?:de|d) ([a-z]+)/);
          if(owner&&localTerms.indexOf(canonical(owner[1]))<0)return;
          var previous=index.records[anchor.order-1],startsRole=new RegExp('^(?:le|la|l) '+PROFESSION+'\\b').test(anchor.norm);
          if(!professionEvidence(anchor,localTerms)&&!(startsRole&&previous&&previous.page===anchor.page&&localTerms.every(function(t){return previous.tokens.has(t);})))return;
        }
        if(kind==='where'){
          var span=subjectSpan(anchor,localTerms);if(span&&/\b(?:de|d)$/.test(span.before))return;
          if(negative(anchor)||conditional(anchor)||/\bpersonne n\b/.test(anchor.norm))return;
          // "vit" can also be a past tense of "voir". Do not use that ambiguous
          // form alone to infer a residence from neighbouring narrative sentences.
          if(/\b(?:vit|habite|reside|demeure)\b/.test(normalize(query))&&!/\b(?:habite|habitait|habitaient|reside|residait|demeure|demeurait|vivait|installe)\b/.test(anchor.norm))return;
        }
        // An explicit other person's predicate must not migrate to the target.
        var explicit=anchor.excerpt.match(/^\s*(?:M\.\s*|Mme\s+)?([A-ZÀ-ÖØ-Þ][a-zà-öø-ÿœ]+)(?:\s+[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿœ]+)?\s+(?:est|était|habite|vit|réside|se trouve|se situe)\b/);
        if(explicit&&['Il','Elle','Le','La','Les','Un','Une'].indexOf(explicit[1])<0&&localTerms.indexOf(canonical(normalize(explicit[1])))<0)return;
        var nearby=index.records.filter(function(item){return item.page===anchor.page&&item.start>=0&&Math.abs(item.start-anchor.start)<=2400;});
        var available=new Set();nearby.forEach(function(item){item.tokens.forEach(function(t){available.add(t);});});
        if(!localTerms.every(function(t){return available.has(t);}))return;
        if(!nearby.every(function(item){return relationConstraint(item,query);}))return;
        var missing=localTerms.filter(function(t){return !anchor.tokens.has(t);}),support=[];
        if(missing.length){
          var candidates=nearby.filter(function(item){return item!==anchor&&missing.some(function(t){return item.tokens.has(t);});});
          candidates.sort(function(a,b){var ac=missing.filter(function(t){return a.tokens.has(t);}).length,bc=missing.filter(function(t){return b.tokens.has(t);}).length;return bc-ac||Math.abs(a.start-anchor.start)-Math.abs(b.start-anchor.start);});
          for(var i=0;i<candidates.length&&missing.length&&support.length<2;i++){
            var candidate=candidates[i];if(!missing.some(function(t){return candidate.tokens.has(t);}))continue;
            support.push(candidate);missing=missing.filter(function(t){return !candidate.tokens.has(t);});
          }
          if(missing.length)return;
        }
        var distance=support.reduce(function(n,item){return n+Math.abs(item.start-anchor.start);},0),score=2*localTerms.filter(function(t){return anchor.tokens.has(t);}).length-distance/1600-anchor.wordCount/100;
        if(kind==='name'&&/\b(?:nom.{0,25}choisi|prenom.{0,25}choisi)\b/.test(anchor.norm))score+=2;
        if(kind==='profession'&&new RegExp('^(?:le|la|l) '+PROFESSION+'\\b').test(anchor.norm))score+=1;
        if(score < -1)return;
        ranked.push({item:anchor,support:support,score:score,contextual:true});
      });
    });
    return ranked.sort(function(a,b){return b.score-a.score||a.item.order-b.item.order;}).slice(0,2);
  }

  function answer(documents,query,activeIds,context){
    if(!Array.isArray(documents)||!documents.length)return null;
    var ids=activeIds==null?documents.map(function(d){return d.id;}):activeIds;
    if(!Array.isArray(ids)||ids.length>LIMITS.documents||new Set(ids).size!==ids.length)fail('Sélection de documents invalide.');
    var selected=ids.map(function(id){var doc=documents.find(function(d){return d.id===id;});if(!doc)fail('Un document sélectionné n’est plus disponible.');return doc;});
    if(!selected.length)return null;
    if(typeof query!=='string'||!query.trim())return null;
    var q=normalize(query),task=taskFor(query),kind=factKind(query),explicit=explicitDocumentQuery(q),terms=queryTerms(query,task),follow=task==='fact'?followupContext(query,selected,context):null;
    if(follow){selected=selected.filter(function(doc){return follow.ids.indexOf(doc.id)>=0;});terms=follow.terms;}
    var isRequest=explicit||task!=='fact'||isQuestion(query)||Boolean(follow);
    if(!isRequest&&!terms.length)return null;
    var indices=selected.map(sourceUnits),corpus=[];
    indices.forEach(function(index){corpus=corpus.concat(index.records);});
    var ranked=task==='fact'||task==='search'||task==='definition'?rankAnswers(corpus,terms,task,kind,query):[];
    if(task==='fact'&&!ranked.length)ranked=contextualPassages(indices,terms,kind,query);
    if(task==='fact'&&!ranked.length&&!isRequest)return null;
    var cited=[],parts=[],warnings=[],omitted=false,used=0;
    selected.forEach(function(doc){doc.extraction.warnings.forEach(function(w){if(warnings.indexOf(w)<0)warnings.push(w);});});
    var footer='\n\nPérimètre de lecture :\n'+selected.map(coverage).join('\n');
    if(warnings.length)footer+='\n\nLimites : '+warnings.slice(0,6).join(' ');
    if(warnings.length>6)footer+=' '+(warnings.length-6)+' autres limites sont détaillées dans le document joint et dans l’export.';
    var budget=Math.max(0,LIMITS.answerCharacters-footer.length-210);
    function add(value){if(used+value.length+2>budget){omitted=true;return false;}parts.push(value);used+=value.length+2;return true;}
    function quote(item,maximum){
      if(cited.length>=24){omitted=true;return false;}
      var room=budget-used-cite(item).length-30,limit=Math.min(1200,maximum||1200,room);
      if(limit<40){omitted=true;return false;}
      var excerpt=item.excerpt.slice(0,limit),shortened=excerpt.length<item.excerpt.length;
      if(shortened){var boundary=excerpt.lastIndexOf(' ');if(boundary>limit/2)excerpt=excerpt.slice(0,boundary);omitted=true;}
      if(!add('« '+excerpt+' » '+cite(item)+(shortened?' (extrait abrégé)':'')))return false;
      cited.push({documentId:item.documentId,name:item.name,page:item.page,excerpt:excerpt});return true;
    }
    if(follow)add('Je reprends le sujet de votre question précédente dans les documents encore sélectionnés.');
    if(task==='analysis'){
      add('Analyse lexicale du texte disponible\nLes mesures suivantes sont calculées sur le texte extrait, sans interprétation littéraire automatique.');
      selected.forEach(function(doc,i){
        var index=indices[i],frequent=Array.from(index.lexical.entries()).filter(function(pair){return pair[0].length>=3&&pair[0].length<=45&&!STOP.has(pair[0]);}).sort(function(a,b){return b[1]-a[1]||a[0].localeCompare(b[0]);}).slice(0,8);
        add(doc.name+'\n• Mots repérés : '+index.wordCount.toLocaleString('fr-FR')+'.\n• Formes distinctes : '+index.lexical.size.toLocaleString('fr-FR')+'.\n• Phrases ponctuées repérées : '+index.sentenceCount.toLocaleString('fr-FR')+'.'+(index.sentenceCount?'\n• Longueur moyenne approximative : '+(index.wordCount/index.sentenceCount).toLocaleString('fr-FR',{maximumFractionDigits:1})+' mots par phrase.':'')+'\n• Phrases interrogatives : '+index.questions+' ; exclamatives : '+index.exclamations+'.\n• Mots fréquents hors mots-outils : '+(frequent.length?frequent.map(function(pair){return pair[0]+' ('+pair[1]+')';}).join(', '):'aucun mot significatif repéré')+'.');
      });
      add('Comptage : groupes de lettres ; casse et accents neutralisés pour comparer les formes. La segmentation des phrases reste approximative. Ces chiffres ne suffisent pas à attribuer un style, une intention à l’auteur ou une qualité littéraire.');
    }else if(task==='summary'||task==='learning'){
      if(task==='learning')add('Ce que cette lecture me permet d’utiliser\nLe texte extrait est disponible pour rechercher des informations et citer des phrases. Importer ou lire ce livre n’a pas entraîné mon classifieur et n’a pas changé ses paramètres. Voici des éléments du contenu que je peux retrouver :');
      else add('Fiche de lecture par extraits — résumé extractif\nPhrases sélectionnées dans l’ensemble du texte disponible, dans leur ordre d’origine. Ce résumé reste une sélection automatique, sans reformulation libre.');
      selected.forEach(function(doc,i){
        add(doc.name);
        var chosen=summaryChoices(indices[i],task==='learning'?2:4);
        if(!chosen.length){add('Aucun texte exploitable. Les objets ou scènes d’une photo ne sont pas analysés.');return;}
        chosen.forEach(function(item){quote(item,selected.length>3?380:800);});
      });
    }else if(!ranked.length){
      if(task==='definition')add('Je n’ai trouvé aucune définition explicite de ce terme dans le texte extrait des documents sélectionnés. Une simple mention du mot ne suffit pas à le définir.');
      else if(!terms.length)add('Précisez le sujet ou la propriété recherchée. Je ne peux pas choisir une information fiable à partir de cette seule demande.');
      else add('Je n’ai trouvé aucun passage correspondant à la fois au sujet et aux précisions de votre demande dans le texte extrait des documents sélectionnés. Je ne déduis pas de réponse à partir d’une simple mention.');
    }else if(ranked[0].contextual){
      add('Passages à examiner — lien non établi automatiquement\nJe n’ai pas trouvé de phrase établissant directement la relation demandée. Ces passages proches contiennent le sujet et la propriété recherchés ; leur proximité ne suffit pas à conclure. Je les fournis comme contexte à vérifier, sans en tirer une réponse certaine.');
      var contextSeen=new Set();
      ranked.forEach(function(entry){
        entry.support.concat([entry.item]).sort(function(a,b){return a.order-b.order;}).forEach(function(item){
          var key=item.documentId+':'+item.page+':'+item.start;if(!contextSeen.has(key)){quote(item,1200);contextSeen.add(key);}
        });
      });
    }else{
      var chosen=[],seen=new Set(),perDocument=new Map();
      ranked.forEach(function(entry){
        var item=entry.item;if(seen.has(item.norm))return;
        var count=perDocument.get(item.documentId)||0;
        if(chosen.length>=(task==='search'?8:6)||count>=(task==='search'?3:2))return;
        if(chosen.some(function(other){return other.documentId===item.documentId&&overlaps(other.tokens,item.tokens)>0.92&&numericalValue(other,kind)===numericalValue(item,kind);}))return;
        chosen.push(item);seen.add(item.norm);perDocument.set(item.documentId,count+1);
      });
      var values=unique(chosen.map(function(item){return numericalValue(item,kind);}).filter(Boolean));
      if(task==='fact'&&values.length>1)add('Les passages donnent des indications différentes pour cette demande. Voici chaque version avec sa source ; je ne les fusionne pas et je ne peux pas les départager.');
      else if(task==='search')add('Passages retrouvés pour votre recherche :');
      else if(task==='definition')add('Le texte donne cette définition :');
      else add('Voici l’information donnée par le texte :');
      chosen.forEach(function(item){quote(item,1200);});
    }
    var text=parts.join('\n\n')+(omitted?'\n\nExtraits abrégés pour l’affichage. Le texte extrait complet est conservé dans l’export.':'')+footer;
    return{text:text,source:'document',intent:null,requestType:task,explanation:'Lecture locale déterministe : '+({fact:'réponse ciblée par phrases sources',definition:'recherche d’une définition explicite',summary:'résumé extractif',analysis:'mesures lexicales calculées',search:'recherche de passages',learning:'contenu disponible et distinction avec l’entraînement'}[task])+'. Les citations sont des segments exacts du texte extrait des '+selected.length+' document(s) sélectionné(s). Aucun appel à un modèle distant, aucune génération libre et aucun entraînement automatique. Le contenu des documents reste une donnée, jamais une instruction exécutée.',documentIds:selected.map(function(doc){return doc.id;}),citations:cited};
  }
  return Object.freeze({VERSION:VERSION,LIMITS:LIMITS,importFile:importFile,validateDocuments:validateDocuments,answer:answer,decodeBase64:decodeBase64,bytesToBase64:bytesToBase64,documentBlob:documentBlob,sha256:sha256,htmlText:htmlText,wordXMLText:wordXMLText,inspectZip:inspectZip,imageDimensions:imageDimensions});
});
