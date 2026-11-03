export async function digest(file){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function prepareMaterials(files,existing=[],courseMaterials=[]){
 const materials=[],assets=[],duplicates=[];
 // Lazily fingerprint pre-4.0 files when they are next involved in an import.
 if(files.length&&globalThis.AtelierLocalStore)for(const m of [...existing,...courseMaterials])if(!m.sha256){const db=await AtelierLocalStore.open(),blob=await new Promise((resolve,reject)=>{const r=db.transaction('assets').objectStore('assets').get(m.id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});if(blob)m.sha256=await digest(blob);}
 for(const f of files){
  const hash=await digest(f),same=[...existing,...materials].find(m=>m.sha256===hash);
  if(same){duplicates.push({name:f.name,existing:same.name});continue;}
  const prior=[...existing].reverse().find(m=>m.name===f.name)||[...courseMaterials].reverse().find(m=>m.name===f.name),overlap=courseMaterials.filter(m=>m.sha256===hash);
  const m={id:crypto.randomUUID(),name:f.name,sha256:hash,size:f.size,cursor:1,done:[],total:1,imported:new Date().toISOString(),revisionOf:prior?.id||null,overlap:overlap.map(x=>({id:x.id,name:x.name})),pageMap:{},alignment:''};
  if(/\.json$/i.test(f.name)){const {transcript}=await import('./core.mjs');m.kind='transcript';m.segments=transcript(JSON.parse(await f.text()));m.total=m.segments.length;}
  else if(/\.pdf$/i.test(f.name)){m.kind='pdf';await import('./vendor/pdf-lib.min.js');try{const pdf=await globalThis.PDFLib.PDFDocument.load(await f.arrayBuffer(),{ignoreEncryption:true});m.total=pdf.getPageCount();m.pageHashes=[];for(const page of pdf.getPages()){const refs=page.node.Contents(),objects=refs?.asArray?refs.asArray():refs?[refs]:[],chunks=[];for(const ref of objects){const stream=pdf.context.lookup(ref);if(stream?.getContents)chunks.push(stream.getContents());else chunks.push(new TextEncoder().encode(String(stream||'')));}const joined=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}const hash=await crypto.subtle.digest('SHA-256',joined);m.pageHashes.push([...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join(''));}if(prior?.pageHashes)m.changedPages=m.pageHashes.flatMap((h,i)=>h!==prior.pageHashes[i]?[i+1]:[]);}catch{throw Error('无法读取 '+f.name+' 的 PDF 页数。');}}
  else if(/^image\/(png|jpeg|webp|gif|bmp|avif)$/.test(f.type))m.kind='image';
  else if(/\.(txt|md)$/i.test(f.name)){m.kind='text';m.text=await f.text();if(prior?.text!==undefined){const before=prior.text.split('\n'),after=m.text.split('\n');let first=0;while(first<Math.min(before.length,after.length)&&before[first]===after[first])first++;m.changedFromLine=first+1;}}
  else throw Error(`暂不支持 ${f.name}；音频转写需导入分段 JSON。`);
  if(!m.total)throw Error('资料没有可处理内容：'+f.name);
  m.originalAsset=true;assets.push({id:m.id,blob:f});materials.push(m);
 }
 return {materials,assets,duplicates};
}
