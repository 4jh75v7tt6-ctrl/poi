/* POI — local document reading. Imported content is data, never instructions or code. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.POIDocuments = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  var VERSION = '1.0.0';
  var LIMITS = Object.freeze({ fileBytes: 8 * 1024 * 1024, documents: 6, totalBytes: 12 * 1024 * 1024, textCharacters: 600000, pdfPages: 200, ocrPages: 3, imagePixels: 24000000, imageSide: 1800, zipEntries: 512, zipExpandedBytes: 24 * 1024 * 1024, xmlBytes: 3 * 1024 * 1024, answerCharacters: 16000 });
  var isNode = typeof process === 'object' && process.versions && process.versions.node && typeof require === 'function';
  var scriptURL = !isNode && typeof document !== 'undefined' && document.currentScript && document.currentScript.src;
  var baseURL = isNode ? require('node:url').pathToFileURL(__dirname + '/').href : new URL('./', scriptURL || root.location.href).href;
  var scripts = Object.create(null), pdfPromise = null, resourcesPromise = null, verified = new WeakMap();
  var METHODS = ['text','html','docx','pdf-text','pdf-text+ocr','ocr','none'];
  var MIMES = { text: ['text/plain','text/markdown','text/csv','application/json','text/html'], pdf:['application/pdf'], docx:['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], image:['image/png','image/jpeg','image/webp'] };
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
      keys(doc.extraction,['method','totalPages','processedPages','truncated','warnings'],'Extraction');var ex=doc.extraction;
      if(METHODS.indexOf(ex.method)<0)fail('Méthode d’extraction inconnue.');
      var methodsForKind={text:['text','html'],docx:['docx'],pdf:['pdf-text','pdf-text+ocr'],image:['ocr','none']};
      if(methodsForKind[doc.kind].indexOf(ex.method)<0)fail('La méthode d’extraction ne correspond pas au format.');
      var totalPages=integer(ex.totalPages,'Nombre de pages ou sections',1,1000000),processed=integer(ex.processedPages,'Pages traitées',0,Math.min(totalPages,LIMITS.pdfPages));
      if(typeof ex.truncated!=='boolean'||!Array.isArray(ex.warnings)||ex.warnings.length>20)fail('Limites d’extraction invalides.');
      var warnings=ex.warnings.map(function(w){return string(w,'Avertissement',1000,false);});
      if(!Array.isArray(doc.pages)||doc.pages.length>LIMITS.pdfPages)fail('Nombre d’extraits invalide.');
      var chars=0,last=0,pages=doc.pages.map(function(page){keys(page,['number','text'],'Page');var num=integer(page.number,'Numéro de page',1,totalPages);if(num<=last)fail('Les pages doivent être uniques et ordonnées.');last=num;var t=string(page.text,'Texte extrait',LIMITS.textCharacters,true);chars+=t.length;if(chars>LIMITS.textCharacters)fail('Le texte extrait dépasse 600 000 caractères.');return {number:num,text:t};});
      if(pages.length>processed||last>processed)fail('Le nombre d’extraits dépasse les pages traitées.');
      if(processed<totalPages&&!ex.truncated)fail('Une lecture incomplète doit être signalée comme partielle.');
      var clean={id:doc.id,name:name,mime:doc.mime,size:size,addedAt:time,kind:doc.kind,sha256:hash,dataBase64:doc.dataBase64,pages:pages,extraction:{method:ex.method,totalPages:totalPages,processedPages:processed,truncated:ex.truncated,warnings:warnings}};verified.set(clean,entry);return clean;
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
    if(truncated){value=value.slice(0,LIMITS.textCharacters);warnings.push('Le texte extrait est limité aux 600 000 premiers caractères ; l’original complet reste conservé.');}
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
  async function recognize(worker,canvas,options){
    checkAbort(options.signal);var timeout,abort;
    var failure=new Promise(function(_,reject){timeout=setTimeout(function(){worker.terminate();reject(new Error('Reconnaissance interrompue après 60 secondes.'));},60000);if(options.signal){abort=function(){worker.terminate();reject(abortError());};options.signal.addEventListener('abort',abort,{once:true});}});
    try{var result=await Promise.race([worker.recognize(canvas,{}, {text:true}),failure]);checkAbort(options.signal);return cleanText(result.data&&result.data.text||'');}finally{clearTimeout(timeout);if(abort)options.signal.removeEventListener('abort',abort);}
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
    var warnings=['Le lecteur extrait uniquement le texte visible. Il ne décrit pas les objets, les personnes ou la scène.','La reconnaissance optique peut contenir des erreurs ; vérifiez les passages dans l’original.'],worker=null,canvas=null,text='',method='none';
    try{canvas=await imageCanvas(bytes,mime,options);notify(options,'parse','Image préparée pour la lecture locale.',0.25);worker=await newOCR(options);text=await recognize(worker,canvas,options);method='ocr';if(!text)pushWarning(warnings,'Aucun texte lisible détecté dans cette image.');}
    catch(error){if(error.name==='AbortError')throw error;pushWarning(warnings,'Texte non extrait : '+error.message+' L’image originale est conservée.');}
    finally{if(worker)await worker.terminate().catch(function(){});if(canvas){canvas.width=0;canvas.height=0;}}
    var truncated=method==='none'||text.length>LIMITS.textCharacters;if(text.length>LIMITS.textCharacters){text=text.slice(0,LIMITS.textCharacters);pushWarning(warnings,'Le texte reconnu est limité à 600 000 caractères.');}
    return {pages:[{number:1,text:text}],extraction:{method:method,totalPages:1,processedPages:1,truncated:truncated,warnings:warnings}};
  }
  async function parsePDF(bytes,options){
    notify(options,'parse','Ouverture du PDF local…',0.1);var pdfjs=await withAbort(loadPDF(),options.signal);checkAbort(options.signal);
    var loading=pdfjs.getDocument({data:bytes.slice(),isEvalSupported:false,useWorkerFetch:false,BinaryDataFactory:BinaryDataFactory,cMapUrl:asset('vendor/pdfjs/cmaps/'),standardFontDataUrl:asset('vendor/pdfjs/standard_fonts/'),wasmUrl:asset('vendor/pdfjs/wasm/'),maxImageSize:LIMITS.imagePixels,canvasMaxAreaInBytes:10000000,disableAutoFetch:true,stopAtErrors:false,enableXfa:false});
    var pdf=null,worker=null,renderTask=null,pages=[],warnings=[],characters=0,ocrAttempts=0,ocrUsed=false,truncated=false,processed=0;
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
              var recognized=await recognize(worker,canvas,options);if(recognized.length>text.length)text=recognized;ocrUsed=true;
            }catch(error){if(error.name==='AbortError'||options.signal&&options.signal.aborted)throw abortError();truncated=true;pushWarning(warnings,'OCR de la page '+i+' indisponible : '+error.message);if(worker){await worker.terminate().catch(function(){});worker=null;}}
            finally{if(canvas){canvas.width=0;canvas.height=0;}}
          }else{truncated=true;pushWarning(warnings,'Certaines pages contiennent peu de texte sélectionnable. L’OCR est limité à trois pages par PDF ; les autres images ne sont pas lues.');}
        }
        processed++;if(characters+text.length>LIMITS.textCharacters){text=text.slice(0,LIMITS.textCharacters-characters);truncated=true;pushWarning(warnings,'Texte extrait limité aux 600 000 premiers caractères ; l’original complet est conservé.');}
        pages.push({number:i,text:text});characters+=text.length;page.cleanup();if(characters>=LIMITS.textCharacters){if(processed<total){truncated=true;pushWarning(warnings,'La limite de 600 000 caractères est atteinte avant la fin du PDF ; les pages suivantes ne sont pas lues.');}break;}if(i%4===0)await delay();
      }
      if(ocrUsed)pushWarning(warnings,'Des passages proviennent de reconnaissance optique française ; vérifiez les citations dans l’original.');
      pushWarning(warnings,'L’ordre du texte peut différer de la mise en page, notamment avec des colonnes, tableaux ou formules.');
      return {pages:pages,extraction:{method:ocrUsed?'pdf-text+ocr':'pdf-text',totalPages:total,processedPages:processed,truncated:truncated,warnings:warnings}};
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
  function normalize(value){return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
  var STOP=new Set(('a au aux avec ce ces cette cet de des du dans en et est es etre je tu il elle nous vous ils elles le la les un une d l j qu que qui quoi quel quelle quels quelles comment pourquoi pour par sur ton ta tes mon ma mes moi toi me te se peux peut puis veux voudrais souhaite aimerais donne montre indique explique concernant parle propos texte document documents fichier fichiers livre livres ouvrage ouvrages photo photos image images piece jointe pieces jointes cherche recherche trouve passage passages cite cites citation citations extrait extraits lire lis lecture s dit sont pas plus moins merci faire fait fais resume resumer analyse analyser etudie etudier etude etudes synthese').split(' '));
  function words(value){return normalize(value).split(' ').filter(function(w){return w.length>=2&&!STOP.has(w);});}
  function snippets(doc){var out=[];doc.pages.forEach(function(page){var paragraphs=page.text.split(/\n\s*\n|\n(?=[A-ZÀ-ÖØ-Þ])/).map(function(s){return s.trim();}).filter(Boolean);paragraphs.forEach(function(paragraph){for(var offset=0;offset<paragraph.length;offset+=650){var excerpt=paragraph.slice(offset,offset+750).trim();if(excerpt)out.push({documentId:doc.id,name:doc.name,page:page.number,kind:doc.kind,excerpt:excerpt});}});});return out;}
  function readingChoices(pool,maximum){
    var unique=new Set(),candidates=[];
    pool.forEach(function(item,index){var text=item.excerpt.trim(),key=normalize(text);if(unique.has(key))return;unique.add(key);var count=key?key.split(' ').length:0;
      // Prefer sentences over short standalone headings, without inferring their meaning.
      var sentence=count>=4&&/[.!?…][»”"')\]]*$/.test(text),substantial=text.length>=90&&count>=12;
      candidates.push({item:item,index:index,informative:sentence||substantial,score:Math.min(count,55)+(/\d/.test(text)?8:0)+(sentence?8:0)});
    });
    var informative=candidates.filter(function(c){return c.informative;});if(informative.length)candidates=informative;
    if(candidates.length<=maximum)return candidates.map(function(c){return c.item;});
    var pages=[],groups=new Map();candidates.forEach(function(c){if(!groups.has(c.item.page)){pages.push(c.item.page);groups.set(c.item.page,[]);}groups.get(c.item.page).push(c);});
    groups.forEach(function(group){group.sort(function(a,b){return b.score-a.score||a.index-b.index;});});
    var chosen=[],taken=new Set(),pageCount=Math.min(maximum,pages.length);
    for(var i=0;i<pageCount;i++){var pageIndex=pageCount===1?0:Math.round(i*(pages.length-1)/(pageCount-1)),choice=groups.get(pages[pageIndex])[0];chosen.push(choice);taken.add(choice.index);}
    candidates.slice().sort(function(a,b){return b.score-a.score||a.index-b.index;}).some(function(choice){if(chosen.length>=maximum)return true;if(!taken.has(choice.index)){chosen.push(choice);taken.add(choice.index);}return false;});
    return chosen.sort(function(a,b){return a.index-b.index;}).map(function(c){return c.item;});
  }
  function cite(item){return '['+item.name+', '+(item.kind==='pdf'?'p. ':item.kind==='image'?'image ': 'extrait ')+item.page+']';}
  function coverage(doc){var chars=doc.pages.reduce(function(n,p){return n+p.text.length;},0),readable=doc.pages.filter(function(p){return p.text.trim();}).length;return doc.name+' — '+chars.toLocaleString('fr-FR')+' caractères extraits ; '+readable+' '+(doc.kind==='pdf'?'pages':'sections')+' contenant du texte ; '+doc.extraction.processedPages+'/'+doc.extraction.totalPages+' unités traitées'+(doc.extraction.truncated?' ; lecture partielle':'')+'.';}
  function answer(documents,query,activeIds){
    if(!Array.isArray(documents)||!documents.length)return null;var ids=activeIds==null?documents.map(function(d){return d.id;}):activeIds;
    if(!Array.isArray(ids)||ids.length>LIMITS.documents||new Set(ids).size!==ids.length)fail('Sélection de documents invalide.');
    var selected=ids.map(function(id){var doc=documents.find(function(d){return d.id===id;});if(!doc)fail('Un document sélectionné n’est plus disponible.');return doc;});if(!selected.length)return null;
    var q=normalize(query),explicit=/(document|fichier|livre|ouvrage|photo|image|piece jointe|lecture|resume|resumer|analyse|etudie|etudier|etude|synthe|lis ce|lis le|lis les|que dit|passage|citation)/.test(q),overview=/(resume|resumer|fiche de lecture|lis ce|lis le|lis les|de quoi parle|presente ce|analyse|analyser|etudie|etudier|etude|synthe|que contient)/.test(q)&&!/(cherche|recherche|trouve|cite|citation|passage|combien|quelle quantite)/.test(q);
    var keywords=Array.from(new Set(words(query)));var titleWords=new Set();selected.forEach(function(d){words(d.name.replace(/\.[^.]+$/,'')).forEach(function(w){titleWords.add(w);});});keywords=keywords.filter(function(w){return !titleWords.has(w);});
    if(!explicit&&!keywords.length)return null;
    var corpus=[];selected.forEach(function(doc){corpus=corpus.concat(snippets(doc));});var cited=[],parts=[],warnings=[];
    selected.forEach(function(doc){doc.extraction.warnings.forEach(function(w){if(warnings.indexOf(w)<0)warnings.push(w);});});
    var footer='\n\nPérimètre de lecture :\n'+selected.map(coverage).join('\n');
    if(warnings.length)footer+='\n\nLimites : '+warnings.slice(0,6).join(' ');
    if(warnings.length>6)footer+=' '+(warnings.length-6)+' autres limites sont détaillées dans le document joint et dans l’export.';
    // Reserve the full coverage/limits footer before spending the response budget on excerpts.
    var bodyBudget=LIMITS.answerCharacters-footer.length-190,usedCharacters=0,omitted=false;
    function add(value){if(usedCharacters+value.length+2>bodyBudget){omitted=true;return false;}parts.push(value);usedCharacters+=value.length+2;return true;}
    function addExcerpt(item,limit){var room=bodyBudget-usedCharacters-cite(item).length-12;if(room<100){omitted=true;return false;}var short=Object.assign({},item,{excerpt:item.excerpt.slice(0,Math.min(limit,room))});if(short.excerpt.length<item.excerpt.length)omitted=true;if(!add(cite(short)+'\n« '+short.excerpt+' »'))return false;cited.push(short);return true;}
    if(overview||explicit&&!keywords.length){
      add('Fiche de lecture par extraits\nCette fiche cite le texte disponible ; elle ne constitue pas une compréhension générale ni une synthèse libre.');
      var excerptLimit=Math.min(700,Math.floor((bodyBudget-170-selected.length*250)/(selected.length*4)));
      selected.forEach(function(doc){add('\n'+doc.name);var pool=corpus.filter(function(s){return s.documentId===doc.id;});if(!pool.length){add('Aucun texte exploitable. L’original reste joint ; les objets ou scènes d’une photo ne sont pas analysés.');return;}readingChoices(pool,4).forEach(function(item){addExcerpt(item,Math.max(100,excerptLimit));});});
    }else{
      var ranked=corpus.map(function(item,index){var normalized=normalize(item.excerpt),tokens=new Set(words(item.excerpt)),hits=keywords.filter(function(word){return tokens.has(word);});return{item:item,index:index,score:hits.length/(keywords.length||1)+(normalized.indexOf(keywords.join(' '))>=0&&keywords.length?0.5:0),hits:hits.length};}).filter(function(x){return x.hits>0;}).sort(function(a,b){return b.score-a.score||a.index-b.index;});
      if(!ranked.length){if(!explicit)return null;add('Je n’ai trouvé aucun passage correspondant dans le texte extrait des documents sélectionnés. Je ne déduis pas de réponse.');}
      else{add('Passages retrouvés dans vos documents\nLes extraits suivants correspondent aux mots de votre demande. Ils permettent de vérifier le contenu ; je ne complète pas les informations absentes.');var used=new Set();ranked.some(function(entry){var item=entry.item,key=item.documentId+'|'+item.page+'|'+item.excerpt;if(used.has(key))return false;used.add(key);return !addExcerpt(item,750)||cited.length>=8;});}
    }
    var text=parts.join('\n\n')+(omitted?'\n\nExtraits abrégés pour l’affichage. Le texte extrait complet est conservé dans l’export.':'')+footer;
    return {text:text,source:'document',intent:null,explanation:'Lecture locale déterministe de '+selected.length+' document(s) sélectionné(s). Les passages sont cités avec leur fichier et page ou section. Aucun appel à un modèle distant et aucun entraînement automatique. Les documents sont traités comme des données, jamais comme des instructions.',documentIds:selected.map(function(d){return d.id;}),citations:cited.map(function(item){return{documentId:item.documentId,name:item.name,page:item.page,excerpt:item.excerpt};})};
  }
  return Object.freeze({VERSION:VERSION,LIMITS:LIMITS,importFile:importFile,validateDocuments:validateDocuments,answer:answer,decodeBase64:decodeBase64,bytesToBase64:bytesToBase64,documentBlob:documentBlob,sha256:sha256,htmlText:htmlText,wordXMLText:wordXMLText,inspectZip:inspectZip,imageDimensions:imageDimensions});
});
