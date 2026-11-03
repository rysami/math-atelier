(function(root){
 'use strict';
 const M=root.MathAtelier;
 function title(text){return String(text||'').replace(/\[(?:MATH|PHASE|LEARN):[^\]]+\]/g,'').split('\n').map(s=>s.replace(/^#+\s*/, '').trim()).find(Boolean)?.slice(0,100)||'AI 回复';}
 // Directory metadata persists even when full conversation capture is disabled.
 function ordered(previous,incoming){
  const old=previous||[],fresh=incoming||[],merged=M.mergeMessages(old,fresh),byId=new Map(merged.map(m=>[m.id,m])),ids=merged.map(m=>m.id),edges=new Map(ids.map(id=>[id,new Set()]));
  function reaches(from,to){const todo=[from],seen=new Set();while(todo.length){const id=todo.pop();if(id===to)return true;if(seen.has(id))continue;seen.add(id);for(const n of edges.get(id)||[])todo.push(n);}return false;}
  function add(list){for(let i=1;i<list.length;i++){const a=list[i-1].id,b=list[i].id;if(a!==b&&edges.has(a)&&edges.has(b)&&!reaches(b,a))edges.get(a).add(b);}}
  add(fresh);add(old);const degree=new Map(ids.map(id=>[id,0]));for(const next of edges.values())for(const id of next)degree.set(id,degree.get(id)+1);const result=[];
  while(result.length<ids.length){const id=ids.find(id=>degree.get(id)===0);if(id===undefined)break;degree.set(id,-1);result.push(byId.get(id));for(const n of edges.get(id))degree.set(n,degree.get(n)-1);}return result.length===ids.length?result:merged;
 }
 function chronology(rows,order=[]){const byId=new Map(rows.map(m=>[m.id,m]));return ordered(rows,order.filter(id=>byId.has(id)).map(id=>byId.get(id)));}
 function retain(previous,incoming,options={}){
  const old=new Map((previous||[]).map(m=>[m.id,m]));
  const fresh=(incoming||[]).map(m=>{const prior=old.get(m.id);if(!prior)return m;let next={...prior,...m};
   if(typeof prior.text==='string'&&typeof m.text==='string'&&prior.text.length>m.text.length){next.text=prior.text;next.html=prior.html;next.status=prior.status;}
   if(prior.replyTitle&&(!m.replyTitle||m.replyTitle==='AI 回复'))next.replyTitle=prior.replyTitle;
   if(prior.stateText&&!m.stateText)next.stateText=prior.stateText;
   if(prior.entries){const entryId=e=>e.kind+'|'+(e.tagId||e.kindIndex)+'|'+M.hash(e.label);next.entries=M.mergeMessages(prior.entries.map(e=>({...e,id:entryId(e)})),(m.entries||[]).map(e=>({...e,id:entryId(e)}))).map(({id,...e})=>e);}
   return next;
  });
  return options.prepend&&!(incoming||[]).some(m=>old.has(m.id))?ordered(fresh,previous||[]):ordered(previous||[],fresh);
 }

 function replyPhase(text){
  const body=String(text||'').replace(/```[^\n]*\n[\s\S]*?```/g,'').split('\n').filter(l=>!/^\s*>/.test(l));
  const head=(body.find(line=>line.trim())||'').replace(/[*_`#]/g,'');
  if(/资料核对与登记/.test(head)&&/阶段\s*A[^\n]*(?:→|进入)[^\n]*阶段\s*B/.test(body.slice(0,5).join('\n')))return 'B';
  const standard=head.match(/(?:^|\n)\s*阶段\s*([ABCDEF])\s*[-－—]\s*\d+(?=\s|$|[：:｜|])/);if(standard)return standard[1];
  const entering=[...head.matchAll(/(?:进入|开始)\s*阶段\s*([ABCDEF])/g)];if(entering.length)return entering.at(-1)[1];
  if(/(?:全讲|系统)总结/.test(head))return 'C';
  if(/复习卷.*(?:解答|批改)|(?:Exercice|习题).*(?:解答|批改)|跳过.{0,30}(?:复习卷|独立作答)/i.test(head))return 'E';
  const explicit=head.match(/(?:当前阶段[：:]?\s*|阶段\s*)([ABCDEF])(?=[\s：:｜|（(、.。·—-]|$)/);if(explicit)return explicit[1];
  if(/(?:法语|PDF|可打印).*复习卷|复习卷.*(?:生成|交付|已完成)/i.test(head))return 'D';
  if(/全部流程已完成|本讲全部完成/.test(head))return 'F';
  return root.AtelierPrompts?.phaseFrom(body.join('\n'))||null;
 }
 function replyNames(rows){
  const phases=rows.map(r=>r.phase||replyPhase(r.phaseText||r.text)),counts={};let previous=null;
  return rows.map((r,i)=>{const phase=phases[i]||previous||null;if(phase)previous=phase;const key=phase||'待确认',number=(counts[key]||0)+1;counts[key]=number;const {phaseText,...row}=r;return {...row,phase,text:'阶段'+key+'-'+number};});
 }
 function stableLabels(rows,previous={}){
  const groups=new Map(),labels={},out=new Map();for(const row of rows){const key=row.phase||'待确认';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  for(const [phase,list] of groups){const explicit=list.some(r=>r.sourceNumber);let pins=list.map(r=>r.sourceNumber||(!explicit&&(previous[r.key]?.phase===phase)&&previous[r.key].number)||null),last=0,valid=true;
   for(let i=0;i<pins.length;i++)if(pins[i]){const prior=pins.slice(0,i).map((v,j)=>v?j:-1).filter(j=>j>=0).at(-1)??-1;if(pins[i]<=last||pins[i]-last<i-prior)valid=false;last=pins[i];}
   if(!valid)pins=list.map(()=>null);let count=0;for(let i=0;i<list.length;i++){const n=pins[i]||count+1;count=n;const r=list[i];labels[r.key]={phase,number:n};out.set(r.key,{...r,text:'阶段'+phase+'-'+n});}
  }return {rows:rows.map(r=>out.get(r.key)),labels};
 }
 function saved(directory={},archive={},options={}){
  const full=new Map((archive.messages||[]).filter(m=>m.role==='assistant').map(m=>[m.id,m]));
  const rows=chronology(ordered((archive.messages||[]).filter(m=>m.role==='assistant').map(m=>({...m,entries:[]})),directory.messages||[]),options.order),knowledge=[],replies=[],seen=new Set();
  for(const m of rows){
   const original=full.get(m.id),native=m.nativeId!==false&&!/^assistant:|^reply-/.test(m.id),point={key:m.key||m.id,fingerprint:m.fingerprint||'',preview:m.preview||'',offset:110};
   for(const entry of m.entries||[]){if(!M.directoryKind(entry.kind)||!M.directoryLabelAllowed(entry.label))continue;const correction=directory.corrections?.[m.id+'|'+entry.kind+'|'+entry.kindIndex+'|'+M.hash(entry.label)];if(correction==='hidden')continue;const keys=M.directoryIdentityKeys(entry);if(keys.some(k=>seen.has(k)))continue;keys.forEach(k=>seen.add(k));knowledge.push({key:entry.tagId?entry.kind+':'+entry.tagId:m.id+'|'+entry.kind+'|'+entry.kindIndex,text:M.directoryText(entry,{chatId:M.conversation(directory.url||archive.url)?.id}),searchText:[entry.label,...(entry.aliases||[]),entry.tagId||'',entry.statementPreview||'',entry.conditions||''].join(' '),point:{...point,outline:entry,unavailable:!native},saved:true});}
   replies.push({key:m.id,searchText:[m.replyTitle||'',(original?.text||'').slice(0,500)].join(' '),sourceNumber:Number((m.replyTitle||original?.text||'').match(/^\s*(?:##\s*)?阶段[ABCDEF]\s*[-－—]\s*(\d+)/)?.[1])||null,phaseText:[m.replyTitle||'',original?.text||m.stateText||''].join('\n'),text:title(m.replyTitle||original?.text||m.preview),point:{...point,unavailable:!native},saved:true});
  }
  return {knowledge,replies:replyNames(replies)};
 }
 function dedupeKnowledge(rows){const seen=new Set();return rows.filter(row=>{const e=row.point?.outline,keys=e?M.directoryIdentityKeys(e):['display:'+row.text];if(keys.some(k=>seen.has(k)))return false;keys.forEach(k=>seen.add(k));return true;});}
 function merge(cached,live){
  const mergeRows=(old,fresh)=>ordered(old.map(r=>({...r,id:r.key})),fresh.map(r=>({...r,id:r.key}))).map(({id,...r})=>r);
  const liveReplies=(live.replies||[]).map(r=>({...r,key:r.point?.cacheId||r.point?.replyStableId||r.point?.key||r.key,text:r.text.replace(/^\d+\.\s*/, '')}));
  return {...cached,...live,knowledge:dedupeKnowledge(mergeRows(cached.knowledge||[],live.knowledge||[])),replies:replyNames(mergeRows(cached.replies||[],liveReplies.map(r=>({...r,phase:r.phase||replyPhase(r.phaseText||r.text)||cached.replies?.find(old=>old.key===r.key)?.phase||null}))))};
 }
 root.AtelierNavigation={title,retain,saved,merge,replyPhase,replyNames,ordered,chronology,stableLabels};if(typeof module!=='undefined')module.exports=root.AtelierNavigation;
})(globalThis);
