(function(root){
 'use strict';
 const compact=s=>String(s||'').replace(/\s+/g,' ').trim();
 const fields=['task','checkpoint','handoff','tools','gap'];
 // Only explicit, visible protocol records are authoritative. Legacy prose remains unconfirmed.
 function extract(messages,previous={}){
  const state={version:1,tasks:{},...previous,updated:new Date().toISOString()};
  state.tasks={...state.tasks};state.scope='仅来自实际采集的消息，不代表原始资料已覆盖。';
  for(const m of messages||[]){if(m.role!=='assistant')continue;
   state.lastAssistantId=m.id;const text=String(m.text||''),token=/\[LEARN:(task|result|checkpoint|handoff|tools|gap):([a-z0-9][a-z0-9_-]{0,63})\][ \t]*([^\n]*)/ig;
   for(const hit of text.matchAll(token)){
    const [,kind,id,value]=hit,record={id,text:value.trim().slice(0,6000),messageId:m.id,sourceKey:m.key};
    if(kind.toLowerCase()==='task'){
     const old=state.tasks[id]||{},parts=record.text.split('｜'),status=parts[0]?.trim();
     const statuses=['待作答','部分作答','待批改','已讲解','已完成','提示中'];
     if(!statuses.includes(status))continue;
     const task={...old,...record,status,title:parts[1]?.trim()||old.title||'当前任务',statement:parts[2]?.trim()||old.statement||'',tools:parts[3]?.trim()||old.tools||'',subquestions:parts.slice(4).map(p=>p.trim()).filter(Boolean)};
     state.tasks[id]=task;state.currentTask=['待作答','部分作答','待批改','提示中'].includes(status)?id:(state.currentTask===id?null:state.currentTask);
    }else if(kind.toLowerCase()==='result'){const [title,aliases,conditions,status,method,location]=record.text.split('｜');state.results||={};state.results[id]={...record,title:title||'',aliases:(aliases||'').split(/[；;]/).filter(Boolean),conditions:conditions||'',status:status||'未确认',method:method||'',location:location||''};}
    else if(fields.includes(kind.toLowerCase()))state[kind.toLowerCase()]=record;
   }
   const phase=AtelierPrompts.phaseFrom(text);if(phase){state.phase=phase;state.detectedPhase=phase;state.phaseMessageId=m.id;}
  }
  if(state.userCompletion?.active){state.phase='F';state.currentTask=null;}
  if(state.phaseOverride?.messageId&&state.phaseOverride.messageId!==state.lastAssistantId)delete state.phaseOverride;
  if(state.phaseOverride?.phase)state.phase=state.phaseOverride.phase;
  return state;
 }
 function concepts(directory,chatId,previous=[],learning={}){
  const map=new Map(previous.map(c=>[c.id,c]));
  for(const m of directory?.messages||[])for(const e of m.entries||[]){
   if(!MathAtelier.directoryKind(e.kind)||!MathAtelier.directoryLabelAllowed(e.label))continue;
   const id=e.tagId?`${e.kind}:${e.tagId}`:`${chatId}:${m.id}:${e.kind}:${e.kindIndex}`;
   const old=map.get(id),detail=learning.results?.[e.tagId]||{};map.set(id,{...old,id,kind:e.kind,title:compact(e.label),aliases:[...new Set([...(old?.aliases||[]),...(e.aliases||[]),...(detail.aliases||[])])],conditions:detail.conditions||e.conditions||old?.conditions||'',proofStatus:detail.status||'未确认',method:detail.method||'',proofMessageId:detail.messageId,chatId:old?.chatId||chatId,messageId:old?.messageId||m.id,outline:old?.outline||e});
  }
  return [...map.values()];
 }
 function context(s){if(!s)return '';const task=s.tasks?.[s.currentTask];return [s.phase&&'阶段 '+s.phase,task&&`当前任务 ${task.id}：${task.title}；${task.status}；陈述：${task.statement}；允许工具：${task.tools}；小问：${(task.subquestions||[]).join('；')}`,s.checkpoint&&'精确断点：'+s.checkpoint.text,s.tools&&'课程工具范围：'+s.tools.text,s.gap&&'实际资料缺口：'+s.gap.text,s.handoff&&'讲次交接：'+s.handoff.text].filter(Boolean).join('\n');}
 function aggregate(rows){const map=new Map();for(const r of rows){const key=r.id+'|'+compact(r.conditions),old=map.get(key);if(!old){map.set(key,{...r,proofUrl:r.url});continue;}old.aliases=[...new Set([...old.aliases,...r.aliases,...(r.title!==old.title?[r.title]:[])])];if(['已证','已讲解'].includes(r.proofStatus)&&r.proofMessageId){old.proofStatus=r.proofStatus;old.method=r.method||old.method;old.proofMessageId=r.proofMessageId;old.proofUrl=r.url;}}return [...map.values()];}
 root.AtelierLearning={extract,concepts,context,aggregate};
})(globalThis);
