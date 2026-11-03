import {stages,uid,lesson,transcript,time,coverage,nextUnit,validateBackup,prompt as makePrompt} from './core.mjs';
import './web-core.js';
import './local-store.js';
import {previewBackup,mergeWeb,restoreChoice} from './backup.mjs';
import {prepareMaterials} from './material-import.mjs';
const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const db=await AtelierLocalStore.open();
function read(store,key){return new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function writeState(snapshot,assets=[],force=false){snapshot.revision=await AtelierLocalStore.writeMain(snapshot,assets,force);}
let state=await read('state','main')||{version:1,lessons:[],active:null,drafts:{}};
state.drafts ||= {};
state.trashedCourses ||= [];
const skill=await (await fetch('Universal-Math-SKILL.md')).text();
let saveQueue=Promise.resolve(),viewSerial=0,sourceURL=null,audioURL=null,toastTimer;
const current=()=>state.lessons.find(l=>l.id===state.active);
const material=()=>current()?.materials.find(m=>m.id===current().selected);
function toast(message){$('toast').textContent=message;$('toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').style.display='none',4200);}
function save(assets=[]){const op=saveQueue.then(async()=>{const owner=state,snapshot=structuredClone(state);try{await writeState(snapshot,assets);if(state===owner)state.revision=snapshot.revision;}catch(e){if(e.code==='STALE_STATE'){state=await AtelierLocalStore.readMain();render();}throw e;}});saveQueue=op.catch(()=>{});return op;}
globalThis.atelierFlush=()=>saveQueue;
globalThis.atelierCanEdit=true;
globalThis.atelierSetupLesson=async input=>{if(!globalThis.atelierCanEdit)throw Error('已有编辑窗口，请关闭原窗口后刷新。');await saveQueue;state=await AtelierLocalStore.readMain();const found=input.id&&state.lessons.find(l=>l.id===input.id);if(input.id&&!found)throw Error('讲次已变化，请重新选择。');const l=found||lesson(input.course,input.title,'M'),prepared=await prepareMaterials(input.files||[],l.materials,state.lessons.filter(x=>x.courseId===input.courseId&&x.id!==l.id).flatMap(x=>x.materials));if(!l.title?.trim())throw Error('请填写讲次名称。');if(input.courseId)l.courseId=input.courseId;l.materials.push(...prepared.materials);if(prepared.materials.length){l.selected=prepared.materials[0].id;l.materialsPendingReview=true;}if(!found)state.lessons.push(l);state.active=l.id;await save(prepared.assets);render();return structuredClone(l);};
document.addEventListener('atelier:select-lesson',e=>{saveQueue.then(async()=>{state=await AtelierLocalStore.readMain();if(!state.lessons.some(l=>l.id===e.detail.id))return;state.active=e.detail.id;await save();render();document.querySelector('[data-view="manage"]').click();if(e.detail.tab)document.querySelector('[data-tab="'+e.detail.tab+'"]').click();}).catch(err=>toast(err.message));});
globalThis.chrome?.runtime?.onMessage?.addListener(msg=>{if(msg.type==='ATELIER_COURSES_CHANGED')saveQueue.then(async()=>{state=await AtelierLocalStore.readMain();$('audio').pause();render();}).catch(e=>toast(e.message));});
function action(id,fn){$(id).addEventListener('click',()=>Promise.resolve().then(fn).catch(e=>toast(`操作未完成：${MathAtelier.connectionMessage(e)}`)));}
function change(id,fn){$(id).addEventListener('change',()=>Promise.resolve().then(fn).catch(e=>toast(`操作未完成：${MathAtelier.connectionMessage(e)}`)));}
function render(){
  const l=current();document.dispatchEvent(new CustomEvent('atelier:lesson',{detail:l?{id:l.id,course:l.course,title:l.title}:null}));$('lessons').replaceChildren();
  if(!state.lessons.length)$('lessons').append(new Option('尚未建立讲次',''));
  for(const x of state.lessons)$('lessons').append(new Option(`${x.course} · ${x.title}`,x.id));
  $('lessons').value=state.active||'';$('empty').hidden=!!l;$('workspace').hidden=!l;
  if(!l){++viewSerial;if(sourceURL)URL.revokeObjectURL(sourceURL);sourceURL=null;$('viewer').replaceChildren();$('reader').hidden=true;return;}
  $('courseTitle').textContent=`${l.course} · ${l.title}`;$('mode').textContent=`模式 ${l.mode}`;$('stage').value=l.stage;
  $('stageStatus').textContent=`已确认完成：${l.completed.map(s=>`${s} ${stages[s]}`).join(' / ')||'无'}。切换阶段不会自动标记完成。`;
  const pending=l.proofs.filter(p=>p.status!=='已通过').length;
  $('nextStep').textContent=l.stage==='A'?'建议：登记本讲资料，确认 ChatGPT 能读取所需文件后进入 B。可用下方入口打开本讲聊天上传资料。':l.stage==='B'?(pending?`还有 ${pending} 个证明任务待处理；先作答或订正，再推进精读。`:coverage(l).complete?'本讲资料已覆盖。确认 B 完成后，切换 C 做系统总结。':'从当前未读位置继续。概念疑问可直接使用网页上的“问答”。'):l.stage==='C'?'对照覆盖清单与资料缺口完成系统总结，再进入 D。':l.stage==='D'?'复习卷生成后先独立作答，交卷时进入 E；不自动展开答案。':l.stage==='F'?'本讲已完成，可按需要复习；不自动开始下一讲。':'保留批改依据，订正实质漏洞并更新薄弱点；不自动跳到下一讲。';
  const c=coverage(l);$('coverage').max=c.total||1;$('coverage').value=c.done;$('coverageText').textContent=`精读覆盖 ${c.done} / ${c.total} 项${c.complete?' · 全部已确认覆盖':''}`;
  $('notes').value=l.notes;$('draft').value=state.drafts[l.id]||'';
  $('materials').replaceChildren();
  for(const m of l.materials){const b=el('button',undefined,`material${m.id===l.selected?' selected':''}`);b.append(el('span',m.name),el('small',`${m.done.length}/${m.total}`));b.onclick=()=>{l.selected=m.id;save().then(renderReader).catch(e=>toast(e.message));for(const x of $('materials').children)x.classList.toggle('selected',x===b);};$('materials').append(b);}
  renderProofs();renderWeak();renderReader().catch(e=>toast(e.message));
}
async function renderReader(){
  const serial=++viewSerial,m=material();$('reader').hidden=!m;
  if(sourceURL){URL.revokeObjectURL(sourceURL);sourceURL=null;}
  $('viewer').replaceChildren();$('openSource').hidden=true;if(!m)return;
  $('sourceName').textContent=m.name+(m.revisionOf?' · 新修订（旧版保留）':'')+(m.changedFromLine?' · 第'+m.changedFromLine+'行起变化':'')+(m.overlap?.length?' · 与既往资料相同':'')+(m.changedPages?.length?' · 内容流变化页：'+m.changedPages.join('、'):'');let provenance=$('materialProvenance');if(!provenance){provenance=el('details');provenance.id='materialProvenance';$('viewer').before(provenance);}provenance.replaceChildren(el('summary','页码和来源对应（可选）'));const page=el('input');page.placeholder='当前PDF页的印刷／手写页码';page.value=m.pageMap?.[m.cursor]||'';const align=el('textarea');align.placeholder='仅记录可核对的对应，例如：PDF第8页 ↔ 照片3 ↔ 转写12:30；不确定标待核对';align.value=m.alignment||'';const apply=el('button','保存对应');apply.onclick=async()=>{m.pageMap||={};m.pageMap[m.cursor]=page.value.slice(0,100);m.alignment=align.value.slice(0,4000);await save();toast('已保存来源对应');};provenance.append(page,align,apply);$('position').value=m.cursor;$('position').max=m.total;
  $('prev').disabled=m.cursor===1;$('next').disabled=m.cursor===m.total;
  $('markRead').textContent=m.done.includes(m.cursor)?'撤回当前项已精读':'确认当前项已精读';
  $('transcriptEdit').hidden=m.kind!=='transcript';
  if(m.kind==='transcript'){
    const s=m.segments[m.cursor-1];$('viewer').append(el('div',`分段 ${m.cursor} · ${time(s.start)}–${time(s.end)}`,'muted'),el('pre',s.text));
    $('correction').value=s.correction||'';$('segmentNote').value=s.note||'';$('evidence').value=s.evidence||'未核听';
  }else if(m.kind==='text'){$('viewer').append(el('pre',m.text));}
  else{
    const blob=await read('assets',m.id);if(serial!==viewSerial)return;
    if(!blob){$('viewer').append(el('p','原文件缺失，请恢复包含资料的完整备份。'));return;}
    sourceURL=URL.createObjectURL(blob);$('openSource').href=sourceURL+(m.kind==='pdf'?`#page=${m.cursor}`:'');$('openSource').hidden=false;
    if(m.kind==='image'){const img=el('img');img.src=sourceURL;img.alt=m.name;$('viewer').append(img);}
    else{const frame=el('iframe');frame.src=sourceURL+`#page=${m.cursor}`;frame.title='PDF 原始资料';$('viewer').append(frame,el('p','PDF 内部滚动不会自动更新断点；请在上方设置实际页码。若内嵌预览不可用，点击“打开原文件”。','muted'));}
  }
}
async function move(n){const m=material();if(!m)return;m.cursor=Math.max(1,Math.min(m.total,n));await save();await renderReader();}
function renderProofs(){
  $('proofList').replaceChildren();const l=current();
  for(const p of l.proofs){const card=el('div',undefined,'card proof');card.append(el('strong',p.title));
    const answer=el('textarea');answer.value=p.answer;answer.setAttribute('aria-label','已保存的证明');
    const feedback=el('textarea');feedback.value=p.feedback;feedback.placeholder='粘贴批改、修正证明或通过依据';feedback.setAttribute('aria-label','批改与依据');
    const status=el('select');for(const s of ['待作答','待批改','需修正','已通过'])status.append(new Option(s,s));status.value=p.status;status.setAttribute('aria-label','证明状态');
    const b=el('button','保存证明与批改');b.onclick=async()=>{if(status.value==='已通过'&&(!answer.value.trim()||!feedback.value.trim())){toast('请先保留你的证明和通过依据。');return;}p.answer=answer.value;p.feedback=feedback.value;p.status=status.value;try{await save();toast('证明记录已保存');}catch(e){toast(e.message);}};
    card.append(el('p',`建立时位置：${p.source||'未关联'}`,'muted'),answer,feedback,status,b);$('proofList').append(card);
  }
}
function renderWeak(){
  $('weakList').replaceChildren();for(const w of current().weak){const card=el('div',undefined,'card');const label=el('label',undefined,'check');const box=el('input');box.type='checkbox';box.checked=w.resolved;box.onchange=()=>{w.resolved=box.checked;save().catch(e=>toast(e.message));};label.append(box,el('span',w.resolved?'已巩固（自行确认）':'仍需巩固'));card.append(el('p',w.text,'recordline'),label);$('weakList').append(card);}
}
for(const [key,name] of Object.entries(stages))$('stage').append(new Option(`${key} · ${name}`,key));
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>{for(const t of document.querySelectorAll('.tab'))t.hidden=t.id!==b.dataset.tab;for(const n of document.querySelectorAll('[data-tab]'))n.classList.toggle('active',n===b);};
const newLecture=()=>globalThis.chrome?.runtime?.sendMessage?document.dispatchEvent(new CustomEvent('atelier:new-work',{detail:{type:'lecture'}})):$('newDialog').showModal();action('new',newLecture);action('start',newLecture);action('cancelNew',()=>$('newDialog').close());
$('newForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);if(!f.get('course').trim()||!f.get('title').trim())return;const l=lesson(f.get('course').trim(),f.get('title').trim(),f.get('mode'));const choice=$('webCourse');if(choice?.selectedOptions[0]?.textContent===l.course)l.courseId=choice.value;state.lessons.push(l);state.active=l.id;try{await save();$('newDialog').close();e.target.reset();render();}catch(e){toast(e.message);}};
change('lessons',async()=>{state.active=$('lessons').value;await save();render();});
change('stage',async()=>{const l=current(),s=$('stage').value;if(['C','D','E'].includes(s)&&!coverage(l).complete)toast('已切换；仍有资料未覆盖，未将精读标记完成。');l.stage=s;await save();render();});
action('complete',async()=>{const l=current();if(l.stage==='B'&&!coverage(l).complete){toast('仍有未覆盖资料，不能确认 B 阶段完成。可明确切换到其他阶段。');return;}if(!confirm(`确认“${stages[l.stage]}”已实际完成？此操作仅记录你的确认。`))return;if(!l.completed.includes(l.stage))l.completed.push(l.stage);await save();render();});
change('files',async()=>{try{const l=current();if(!l)throw Error('先选择一讲。');const prepared=await prepareMaterials([...$('files').files],l.materials,state.lessons.filter(x=>x.courseId===l.courseId&&x.id!==l.id).flatMap(x=>x.materials));l.materials.push(...prepared.materials);if(prepared.materials.length){l.selected=prepared.materials[0].id;l.materialsPendingReview=true;}await save(prepared.assets);render();toast(`已导入 ${prepared.materials.length} 份；跳过 ${prepared.duplicates.length} 份相同内容。保留原阶段与断点，只续接新资料。`);}finally{$('files').value='';}});
action('prev',()=>move(material().cursor-1));action('next',()=>move(material().cursor+1));
change('position',()=>{const n=Number($('position').value);if(!Number.isInteger(n)||n<1||n>material().total){$('position').value=material().cursor;throw Error('请输入范围内的整数位置。');}return move(n);});
action('unread',()=>{const n=nextUnit(material());if(n===null)toast('这份资料已全部确认覆盖');else return move(n);});
action('markRead',async()=>{const l=current(),m=material(),n=m.cursor;if(m.done.includes(n)){m.done=m.done.filter(x=>x!==n);l.completed=l.completed.filter(x=>!['B','C','D'].includes(x));}else m.done.push(n);await save();render();});
action('saveSegment',async()=>{const s=material().segments[material().cursor-1];s.correction=$('correction').value;s.note=$('segmentNote').value;s.evidence=$('evidence').value;await save();toast('原文保留，校正与注释已保存');});
change('audioFile',()=>{if(audioURL)URL.revokeObjectURL(audioURL);const f=$('audioFile').files[0];if(f){audioURL=URL.createObjectURL(f);$('audio').src=audioURL;}});
action('playSegment',async()=>{const s=material()?.segments?.[material().cursor-1];if(!s)throw Error('先选择一个转写片段。');if(!audioURL)throw Error('先选择对应的原始音频。');if(!Number.isFinite($('audio').duration))throw Error('音频还未加载或格式不支持。');if(s.start>=$('audio').duration)throw Error('该片段超出所选音频时长，请核对资料。');$('audio').currentTime=s.start;try{await $('audio').play();}catch(e){if(e.name!=='AbortError')throw e;}});
$('audio').ontimeupdate=()=>{const s=material()?.segments?.[material().cursor-1];if(s&&$('audio').currentTime>=s.end){if($('loop').checked&&s.end>s.start)$('audio').currentTime=s.start;else $('audio').pause();}};
action('addProof',async()=>{const title=$('proofTitle').value.trim();if(!title)throw Error('请填写证明任务。');const m=material(),answer=$('proofAnswer').value;current().proofs.push({id:uid(),title,answer,feedback:'',status:answer.trim()?'待批改':'待作答',source:m?`${m.name} · ${m.cursor}/${m.total}`:''});await save();$('proofTitle').value='';$('proofAnswer').value='';renderProofs();toast('证明任务已记录');});
action('addWeak',async()=>{const text=$('weakText').value.trim();if(!text)throw Error('请填写具体薄弱点。');current().weak.push({id:uid(),text,resolved:false});await save();$('weakText').value='';renderWeak();});
action('saveNotes',async()=>{current().notes=$('notes').value;await save();toast('讲次备注已保存');});
for(const b of document.querySelectorAll('[data-prompt]'))b.onclick=async()=>{const l=current();$('draft').value=makePrompt(l,b.dataset.prompt,skill);state.drafts[l.id]=$('draft').value;try{await save();toast('消息草稿已生成；可编辑后复制到 ChatGPT');}catch(e){toast(e.message);}};
$('draft').oninput=()=>{if(current()){state.drafts[current().id]=$('draft').value;save().catch(e=>toast(e.message));}};
action('copy',async()=>{if(!$('draft').value)throw Error('请先生成一条消息。');await navigator.clipboard.writeText($('draft').value);toast('已复制；请粘贴到 ChatGPT 检查后发送');});
function download(blob,name){const u=URL.createObjectURL(blob),a=el('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000);}
async function dataURL(blob){return new Promise((resolve,reject)=>{const f=new FileReader();f.onload=()=>resolve(f.result);f.onerror=()=>reject(f.error);f.readAsDataURL(blob);});}
action('export',async()=>{await saveQueue;const snapshot=structuredClone(state),assets=[];for(const m of AtelierLocalStore.fileMaterials(snapshot)){const blob=await read('assets',m.id);if(!blob)throw Error(`备份中止：${m.name} 的文件缺失。`);assets.push({id:m.id,type:blob.type,data:await dataURL(blob)});}let webData;if(globalThis.chrome?.runtime?.sendMessage){const r=await chrome.runtime.sendMessage({type:'MA_EXPORT_WEB'});if(!r?.ok)throw Error(r?.error||'网页记录备份失败');webData=r.data;}download(new Blob([JSON.stringify({...snapshot,assets,webData,readerState:Object.fromEntries(Object.entries(localStorage).filter(([k])=>/^(book-|atelier-reading-prefs$|atelier-reader-replies$)/.test(k)))},null,2)],{type:'application/json'}),`math-atelier-backup-${new Date().toISOString().slice(0,10)}.json`);if(globalThis.chrome?.runtime?.sendMessage)await MathAtelier.runtimeCall('MA_STUDY_META',{op:'export'});toast('已发起完整备份下载，请确认文件已保存；包含回收站，不含临时音频。');});
change('restore',async()=>{
  try{const f=$('restore').files[0];if(!f)return;const incoming=validateBackup(JSON.parse(await f.text())),assets=[];
    for(const m of AtelierLocalStore.fileMaterials(incoming)){const a=incoming.assets?.find(x=>x.id===m.id);if(!a||typeof a.data!=='string'||!/^data:[^,]*;base64,/.test(a.data))throw Error(`备份缺失资料文件：${m.name}`);const bytes=Uint8Array.from(atob(a.data.slice(a.data.indexOf(',')+1)),c=>c.charCodeAt(0));assets.push({id:m.id,blob:new Blob([bytes],{type:m.kind==='pdf'?'application/pdf':(/^image\/(png|jpeg|webp|gif|bmp|avif)$/.test(a.type)?a.type:'application/octet-stream')})});}
    await saveQueue;const currentMain=await AtelierLocalStore.readMain(),mode=await restoreChoice(previewBackup(currentMain,incoming));if(!mode)return;if(incoming.webData)MathAtelier.validateWebData(incoming.webData);const oldWeb=await MathAtelier.runtimeCall('MA_EXPORT_WEB');await AtelierLocalStore.snapshot('导入备份前',oldWeb);const assetMap=new Map(assets.map(a=>[a.id,crypto.randomUUID()]));for(const a of assets)a.id=assetMap.get(a.id);for(const l of [...incoming.lessons,...(incoming.trashedCourses||[]).flatMap(t=>t.lessons)]){for(const m of l.materials){const old=m.id;if(assetMap.has(old))m.id=assetMap.get(old);if(l.selected===old)l.selected=m.id;if(m.revisionOf&&assetMap.has(m.revisionOf))m.revisionOf=assetMap.get(m.revisionOf);}}
    if(incoming.webData&&(!globalThis.chrome?.runtime?.sendMessage))throw Error('本备份包含网页记录，请在扩展内恢复。');
    const restoreWeb=mode==='merge'?mergeWeb(oldWeb,incoming.webData):incoming.webData||{webConfig:{courses:[]}};
    const drafts={};for(const [key,value] of Object.entries(incoming.drafts||{}))if(typeof value==='string')drafts[key]=value;
    const restored={version:1,trashedCourses:incoming.trashedCourses||[],lessons:incoming.lessons,active:incoming.lessons.some(l=>l.id===incoming.active)?incoming.active:incoming.lessons[0]?.id||null,drafts};
    if(mode==='merge'){const ids=new Set([...currentMain.lessons,...(currentMain.trashedCourses||[]).flatMap(t=>t.lessons)].map(l=>l.id));restored.lessons=[...currentMain.lessons,...restored.lessons.filter(l=>!ids.has(l.id))];restored.drafts={...restored.drafts,...currentMain.drafts};restored.active=currentMain.active||restored.active;restored.trashedCourses=[...(currentMain.trashedCourses||[]),...restored.trashedCourses.filter(t=>!(currentMain.trashedCourses||[]).some(x=>x.id===t.id)).map(t=>({...t,lessons:t.lessons.filter(l=>!ids.has(l.id))}))];}validateBackup(restored);try{await writeState(restored,assets,true);await MathAtelier.runtimeCall('MA_IMPORT_WEB',{data:restoreWeb,replace:true});state=restored;for(const [k,v] of Object.entries(incoming.readerState||{}))if(/^(book-|atelier-reading-prefs$|atelier-reader-replies$)/.test(k)&&typeof v==='string'&&(mode==='replace'||localStorage.getItem(k)===null))localStorage.setItem(k,v);}catch(e){await writeState(currentMain,[],true);await MathAtelier.runtimeCall('MA_IMPORT_WEB',{data:oldWeb,replace:true});state=currentMain;throw e;}render();toast('备份已恢复；导入前恢复点已保存。');
  }finally{$('restore').value='';}
});
// A single editing surface prevents stale windows from silently overwriting progress.
if(navigator.locks){navigator.locks.request('math-atelier-editor',{ifAvailable:true},async lock=>{if(!lock){globalThis.atelierCanEdit=false;for(const n of document.querySelectorAll('button,input,textarea,select'))n.disabled=true;toast('已有学习窗口正在编辑。请关闭原窗口后刷新此页。');return;}await new Promise(resolve=>window.addEventListener('pagehide',resolve,{once:true}));});}
render();

action('openLessonChat',async()=>{const l=current();if(!l)throw Error('先选择一讲。');const cfg=await MathAtelier.runtimeCall('MA_CONFIG'),c=cfg.courses.find(c=>c.id===l.courseId)||cfg.courses.find(c=>c.name===l.course);if(!c)throw Error('请先从新建／导入建立课程，再导入到对应讲次。');const bound=c.lectures.find(x=>x.lessonId===l.id)||c.lectures.find(x=>x.title===l.title);if(bound){await MathAtelier.runtimeCall('MA_OPEN_CHAT',{url:bound.url});toast('已打开本讲聊天。点击 ChatGPT 输入框旁的“＋”，选择原文件并等待上传完成，再发送学习请求。');}else{const record=await globalThis.atelierSetupLesson({id:l.id,course:l.course,courseId:c.id,title:l.title,files:[]});await MathAtelier.runtimeCall('MA_NEW_CHAT',{courseId:c.id,kind:'lecture',title:l.title,lessonId:record.id});toast('已打开新聊天。点“＋”上传资料并发送第一条消息后，插件自动绑定。');}});
