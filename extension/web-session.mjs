import './web-core.js';
import './prompts.js';
import './math-tags.js';
const M=MathAtelier,P=AtelierPrompts,$=id=>document.getElementById(id),call=(type,data={})=>M.runtimeCall(type,data);
let active=null,info=null,busy=false,epoch=0,watching=false,signature='',drafts={};
try{drafts=JSON.parse(localStorage.getItem('atelier-reader-replies')||'{}');if(!drafts||Array.isArray(drafts)||typeof drafts!=='object')drafts={};}catch{}
let navTab='knowledge',navData=null,navEpoch=0,navTimer,jumpEpoch=0,lastJump=null,statusUntil=0;
function chooseTab(tab){navTab=tab;document.getElementById('webSession').dataset.tab=tab;$('navigationPane').hidden=tab==='qa';if(tab!=='qa')document.dispatchEvent(new Event('atelier:question-hide'));for(const [id,name] of [['directoryReading','knowledge'],['repliesReading','replies'],['questionReading','qa']])$(id).setAttribute('aria-selected',String(tab===name));if(tab!=='qa')renderNavigation();}
function runningNavigation(){return ['start','earlier','later','found','heading'].includes(navData?.navigation?.operation?.stage)&&Date.now()-navData.navigation.operation.updated<100000;}
async function performJump(request,force=false,returning=false){const attempt=++jumpEpoch;if(M.conversation(request.url)?.id!==active)return;lastJump=returning?lastJump:request;retryJump.hidden=true;try{status('正在寻找原文…');const r=await call('MA_JUMP',{...request,force,returning});if(attempt!==jumpEpoch||M.conversation(request.url)?.id!==active)return;if(!r?.ok){retryJump.hidden=!!r?.cancelled;throw Error(r?.error||'定位失败');}status(r.notice||'已定位。');$('navigationList').querySelectorAll('button').forEach(b=>b.classList.toggle('selected',b.mathEntry?.key===request.itemKey));}catch(e){if(attempt===jumpEpoch){status(e.message);if(!returning)retryJump.hidden=false;}}}
function renderNavigation(){if(navTab==='qa')return;const all=navData?.[navTab]||[],normalize=s=>String(s||'').normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase(),query=normalize($('navigationSearch').value.trim()),items=all.filter(i=>normalize(i.text+' '+(i.searchText||'')).includes(query));$('navigationScope').textContent=navTab==='knowledge'?`${all.length} 个知识点`:`${all.length} 条回复`;M.syncDirectoryRows($('navigationList'),items,async item=>{if(item.point?.unavailable&&!item.point?.replyNodeKey){status('这条历史回复没有稳定定位标识，需要网页加载原文后重新识别。');return;}await performJump({url:navData.url,tabId:navData.tabId,point:item.point,itemKey:item.key});});if(!items.length){$('navigationList').replaceChildren();const empty=document.createElement('p');empty.className='muted';empty.textContent=query?'没有匹配的条目。':navTab==='replies'?'还没有采集到AI回复。':'正式知识点生成后会出现在这里。';$('navigationList').append(empty);}updateSaved();}
async function loadNavigation(cachedOnly=false){if(!active)return;const id=active,version=++navEpoch,url='https://chatgpt.com/c/'+id;try{const cached=await call('MA_NAVIGATION',{url,cachedOnly:true});if(id!==active||version!==navEpoch)return;navData=cached;renderNavigation();if(cachedOnly)return;const data=await call('MA_NAVIGATION',{url});if(id!==active||version!==navEpoch)return;navData=data;renderNavigation();if(data.notice)status(data.notice);}catch(e){if(version===navEpoch)status(e.message);}}

$('navigationSearch').oninput=renderNavigation;
const record=()=>drafts[active]||(drafts[active]={text:''});
const save=()=>localStorage.setItem('atelier-reader-replies',JSON.stringify(drafts));
const status=text=>{if(!text&&(runningNavigation()||Date.now()<statusUntil))return;$('readingStatus').textContent=text;if(text)statusUntil=Date.now()+6000;};

const savedStatus=document.createElement('button');
savedStatus.id='sessionSaved';
savedStatus.type='button';
savedStatus.className='sessionAction sessionDetailAction';
savedStatus.setAttribute('aria-haspopup','dialog');
$('sessionPhase').after(savedStatus);
const saveDialog=document.createElement('dialog');saveDialog.id='saveDetails';const saveHeading=document.createElement('h2');saveHeading.textContent='保存与采集范围';const saveDetails=document.createElement('p'),saveClose=document.createElement('button');saveClose.textContent='关闭';saveDialog.append(saveHeading,saveDetails,saveClose);document.body.append(saveDialog);saveClose.onclick=()=>saveDialog.close();
function showSaved(){const s=navData?.stats||{},c=s.coverage||{},missing=[!c.first&&'起始端尚未确认',!c.last&&'末尾尚未确认',!c.continuous&&'连续扫描尚未完成'].filter(Boolean);saveDetails.textContent=`已保存${s.savedReplies||0}条AI正文；最近保存：${s.savedAt?new Date(s.savedAt).toLocaleString():'暂无'}。${missing.length?'待核对：'+missing.join('；'):'当前可访问分支已连续扫描到首尾'}。来源：${c.source||'实际加载的网页内容'}。这不覆盖其他分支或未提供的服务器历史。${s.saveError?'保存错误：'+s.saveError+'。':''}自动备份：${s.backupFailedAt?'最近一次失败，请到设置检查':s.backupAt?new Date(s.backupAt).toLocaleString():'尚无'}。设置 → 本机恢复点保留最近5份；可另外导出完整备份。`;saveDialog.showModal();}
savedStatus.onclick=showSaved;

const temporary=document.createElement('div');
temporary.className='temporaryNavigation';
const returnJump=document.createElement('button');
const retryJump=document.createElement('button');
for(const button of [returnJump,retryJump]){
 button.type='button';
 button.className='sessionAction';
 button.hidden=true;
}
returnJump.classList.add('returnPositionAction');
returnJump.textContent='返回原位置';
retryJump.textContent='重新尝试';
temporary.append(returnJump,retryJump);
$('readingStatus').after(temporary);
retryJump.onclick=()=>{if(lastJump)performJump(lastJump,true);};returnJump.onclick=async()=>{const p=navData?.navigation?.returnPoint;if(p){await performJump({url:navData.url,tabId:navData.tabId,point:p},true,true);returnJump.hidden=true;}};
function updateSaved(){const s=navData?.stats||{},c=s.coverage||{};savedStatus.classList.toggle('saveError',!!s.saveError||!!s.backupFailedAt);savedStatus.textContent=s.saveError?'保存失败：'+s.saveError:`已保存 ${s.savedReplies||0} 条回复 · ${c.continuous?'当前网页分支已扫描':c.first&&c.last?'已到首尾，连续性待核对':s.history?.status==='running'?'正在补存历史':'已采集部分'}`;if(s.backupFailedAt)savedStatus.textContent+=' · 自动备份失败，请到设置检查';savedStatus.title='只表示实际采集范围，不代表其他分支、服务端全部历史或课程内容已独立核验。';returnJump.hidden=!navData?.navigation?.returnPoint||navData?.navigation?.operation?.stage!=='done';}
const phaseDialog=document.createElement('dialog');phaseDialog.id='phaseDetails';const phaseTitle=document.createElement('h2');phaseTitle.textContent='阶段依据与修正';const evidence=document.createElement('p'),phaseSelect=document.createElement('select');phaseSelect.setAttribute('aria-label','修正阶段');phaseSelect.add(new Option('恢复自动判断','auto'));for(const [phase,name] of Object.entries(P.phaseNames))phaseSelect.add(new Option('阶段'+phase+' · '+name,phase));const phaseNote=document.createElement('p');phaseNote.className='muted';phaseNote.textContent='修正本机阶段，不改写聊天；有新AI回复后重新按原文判断。';let phaseEvidencePoint=null;const phaseEvidence=document.createElement('button');phaseEvidence.textContent='查看网页阶段记录';phaseEvidence.hidden=true;const phaseApply=document.createElement('button'),phaseClose=document.createElement('button');phaseApply.textContent='保存修正';phaseClose.textContent='关闭';phaseDialog.append(phaseTitle,evidence,phaseEvidence,phaseSelect,phaseNote,phaseApply,phaseClose);document.body.append(phaseDialog);phaseClose.onclick=()=>phaseDialog.close();
async function showPhase(){if(!active||info?.context?.qa)return;try{const r=await call('MA_LEARNING_STATUS',{url:'https://chatgpt.com/c/'+active}),s=r.learning||{},source=s.phaseOverride?'用户修正':s.userCompletion?.active?'用户确认完成':s.phaseMessageId?'已采集AI回复':'缺少可靠阶段记录';evidence.textContent=`当前：${s.phase||'待确认'}；依据：${source}。网页识别阶段：${s.detectedPhase||'待确认'}。最近自动备份：${navData?.stats?.backupAt?new Date(navData.stats.backupAt).toLocaleString():'尚无'}（设置中可恢复本机恢复点）。`;phaseSelect.value=s.phaseOverride?.phase||'auto';phaseEvidencePoint=s.phaseMessageId?{key:s.phaseMessageId}:null;phaseEvidence.hidden=!phaseEvidencePoint;phaseDialog.showModal();}catch(e){status(e.message);}}
$('sessionPhase').title='查看阶段依据或修正';
$('sessionPhase').onclick=showPhase;
phaseEvidence.onclick=()=>{if(phaseEvidencePoint){phaseDialog.close();performJump({url:'https://chatgpt.com/c/'+active,tabId:navData?.tabId,point:phaseEvidencePoint});}};
phaseApply.onclick=async()=>{try{await call('MA_PHASE_OVERRIDE',{url:'https://chatgpt.com/c/'+active,phase:phaseSelect.value});phaseDialog.close();await refresh();status('阶段已更新，原聊天不变。');}catch(e){evidence.textContent=e.message;}};

function update(){const r=active?record():{},ctx=info?.context||{};savedStatus.hidden=!!ctx.qa;$('sessionPhase').disabled=!!ctx.qa;const waiting=info?.awaitingReply&&(!ctx.phase||['B','E'].includes(ctx.phase));$('continueReading').textContent=r.pending?'核对上一条回复':$('lectureReplyText').value.trim()?'发送回复':ctx.phase==='F'?'已完成':waiting?'请先作答':'继续';$('continueReading').disabled=busy||!active||!!info?.generating||ctx.phase==='F'&&!$('lectureReplyText').value.trim()&&!r.pending;$('skipProofReading').hidden=!!ctx.qa||!!ctx.phase&&!['B','E'].includes(ctx.phase);$('skipProofReading').disabled=busy||!active||!!r.pending||!!info?.generating;$('lectureReplyHint').textContent=r.pending?'上一条发送结果未确认，只会核对原消息。':waiting?'可以提交部分证明、请求提示，或跳过当前题看解答。':'';$('sessionPhase').textContent=ctx.qa?'统一问答':ctx.phase==='F'?'已完成':ctx.phase?`阶段${ctx.phase} · ${P.phaseNames[ctx.phase]}`:'阶段待确认';$('sessionTask').textContent=ctx.task?`当前任务：${ctx.task.title}（${ctx.task.status}）`:'';}
async function target(){if(!active)throw Error('请先选择一讲课程。');return call('MA_SESSION_TARGET',{url:'https://chatgpt.com/c/'+active});}
async function refresh(){if(!active)return;const id=active,next=await target();if(id!==active)return;info=next;update();const nextSignature=[id,next.messageCount,next.tailLength,next.lastKey].join(':');if(nextSignature!==signature){await loadNavigation();signature=nextSignature;}status(next.generating?'正在生成…':'');}
async function open(id){++jumpEpoch;lastJump=null;retryJump.hidden=returnJump.hidden=true;++epoch;++navEpoch;navData=null;chooseTab('knowledge');$('navigationSearch').value='';active=id;info=null;signature='';$('lectureReplyText').value=record().text||'';$('sessionTitle').textContent='当前讲次';update();const version=epoch;loadNavigation();try{const lookup=await call('MA_LOOKUP',{url:'https://chatgpt.com/c/'+id});if(version!==epoch)return;const lecture=lookup.course?.lectures.find(l=>M.conversation(l.url)?.id===id);$('sessionTitle').textContent=lecture?.title||lookup.course?.name||'当前讲次';await refresh();}catch(e){status(e.message);}}
document.addEventListener('atelier:open-session',e=>{if(/^[a-z0-9-]{8,}$/i.test(e.detail?.id||''))open(e.detail.id);});
$('lectureReplyText').oninput=()=>{if(active){record().text=$('lectureReplyText').value;save();}update();};
$('lectureReplyText').onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'&&!$('continueReading').disabled){e.preventDefault();send();}};
async function send(skip=false){if(busy||!active)return;busy=true;const id=active,r=record();update();try{info=await target();if(id!==active)throw Error('已切换讲次，未发送。');const ctx=info.context||{},raw=$('lectureReplyText').value.trim();if(skip&&r.pending)throw Error('请先核对上一条回复。');if(!r.pending&&!raw&&!skip){const result=await call('MA_CONTINUE',{tabId:info.tabId});if(!result?.ok){if(result?.needsReply)$('lectureReplyText').focus();throw Error(result?.error||'发送未确认。');}status(result.complete?'本讲已完成。':'已发送当前阶段的续接请求，请在网页查看答复。');}else{
 if(!r.pending){const body=skip||M.isSkipReply(raw)?P.skipText(ctx):P.replyText(raw,ctx);if(!body)throw Error('当前阶段没有可跳过的证明或答卷题。');r.pending={id:crypto.randomUUID(),text:raw,body:P.withUpdate(body,ctx,info.policyNeedsUpdate)};save();}
 const pending=r.pending,result=await call('MA_REPLY',{requestId:pending.id,url:'https://chatgpt.com/c/'+id,tabId:info.tabId,text:pending.body});if(!result?.ok)throw Error(result?.error||'回复发送未确认。');if((r.text||'').trim()===pending.text){r.text='';if(active===id)$('lectureReplyText').value='';}delete r.pending;save();status(result.alreadySent?'已找到原回复，没有重复发送。':'已发回当前讲次，请在ChatGPT网页查看答复。');}
 }catch(e){status(e.message);}finally{busy=false;update();}}
$('continueReading').onclick=()=>send();$('skipProofReading').onclick=()=>send(true);
function action(id,fn){$(id).onclick=async()=>{try{await fn();}catch(e){status(e.message);}};}
action('directoryReading',async()=>{chooseTab('knowledge');await loadNavigation();});
action('repliesReading',async()=>{chooseTab('replies');await loadNavigation();});
action('syncReading',async()=>{const t=await call('MA_CURRENT'),id=M.conversation(t.url)?.id;if(!id)throw Error('请先选中课程网页。');await open(id);});
action('setupReading',()=>document.dispatchEvent(new CustomEvent('atelier:new-work',{detail:{type:'import',chatId:active}})));
action('helpReading',()=>call('MA_HELP'));
action('questionReading',async()=>{chooseTab('qa');const t=await target(),quote=await call('MA_WEB_QUOTE',{tabId:t.tabId});document.dispatchEvent(new CustomEvent('atelier:question',{detail:{id:active,title:$('sessionTitle').textContent,quote:quote.selected?quote.text:'',suggestedQuote:quote.text,quoteInfo:quote,anchor:quote.anchor}}));});
for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>{document.body.classList.remove('landing-mode','wizard-mode','manage-mode','session-mode');document.body.classList.add(b.dataset.view==='session'?'session-mode':'manage-mode');$('landing').hidden=true;$('flowScreen').hidden=true;$('courseHome').hidden=true;$('backHome').hidden=false;$('readingMore').open=false;};
setInterval(async()=>{if(watching||busy||!active||!document.body.classList.contains('session-mode'))return;watching=true;try{await refresh();}catch(e){status(e.message);}finally{watching=false;}},2500);
chrome.storage.onChanged.addListener((changes,area)=>{
 if(area==='session'&&active&&changes['saveHealth:'+active]&&navData?.stats){navData.stats.saveError=changes['saveHealth:'+active].newValue?.error||null;updateSaved();}if(area!=='local'||!active)return;if(changes.studyMeta?.newValue&&navData?.stats){navData.stats.backupAt=changes.studyMeta.newValue.lastAutomaticBackupAt||0;navData.stats.backupFailedAt=changes.studyMeta.newValue.automaticBackupFailedAt||0;updateSaved();}
 const learning=changes['learning:'+active];if(learning?.newValue&&navData){navData.navigation=learning.newValue.navigation||navData.navigation;if(navData.stats){navData.stats.coverage=learning.newValue.historyCoverage||{};navData.stats.history=learning.newValue.historyCapture||null;}const op=navData.navigation?.operation;if(op&&op.updated!==learning.oldValue?.navigation?.operation?.updated&&['start','earlier','later','found','heading','cancelled','cooldown','failed','done'].includes(op.stage)){status(op.detail||({start:'正在寻找原文',earlier:'正在加载更早历史',later:'正在加载后续历史',found:'已找到回复，正在展开',heading:'正在定位知识点',done:'已定位。',cancelled:'已停止定位'}[op.stage]||''));}updateSaved();}
 const archive=changes['archive:'+active];if(archive?.newValue&&navData?.stats){navData.stats.savedReplies=archive.newValue.messages.filter(m=>m.role==='assistant').length;navData.stats.savedAt=archive.newValue.updated;updateSaved();}
 if(changes['directory:'+active]){clearTimeout(navTimer);navTimer=setTimeout(()=>{if(document.body.classList.contains('session-mode'))loadNavigation(true);},450);}
 const answered=Object.entries(changes).some(([k,v])=>k.startsWith('question:')&&v.newValue?.status==='已答复'&&v.oldValue?.status!=='已答复'&&M.conversation(v.newValue.source)?.id===active);if(answered)status('统一问答已有答复，可打开问答查看。');
});

document.addEventListener('atelier:question-return',async e=>{if(M.conversation(e.detail?.url)?.id!==active)return;chooseTab('knowledge');if(e.detail.point)await performJump({url:e.detail.url,point:e.detail.point},true,true);});
