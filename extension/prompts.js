(function(root){
 'use strict';
 const phaseNames={A:'资料核对',B:'精读与主动证明',C:'系统总结',D:'法语复习卷',E:'答卷批改',F:'已完成'};
 function phaseFrom(text){
  const raw=String(text||'').replace(/```[^\n]*\n[\s\S]*?```/g,'');let current=null;
  for(const original of raw.split('\n')){
   if(/^\s*>/.test(original))continue;
   const line=original.replace(/[*_`#]/g,'').trim();
   const tag=line.match(/^\[PHASE:([ABCDEF])\]$/);if(tag){current=tag[1];continue;}
   if(/(?:本讲|第\s*[一二三四五六七八九十\d]+\s*讲)(?:至此|现已|已经|[ ·｜|]){0,4}(?:全部完成|全部(?:阶段|流程)(?:均已|已)?完成)/.test(line)&&!/未完成|尚未|没有完成|不代表|不等于/.test(line)){current='F';continue;}
   const phase=line.match(/^(?:(?:第\s*[一二三四五六七八九十\d]+\s*讲)[｜|·：: ]*)?(?:(?:当前|现在|本轮)(?:所处)?(?:进入|处于|是|为)?\s*[:：]?\s*)?阶段\s*[:：为是]?\s*([ABCDEF])(?=[\s：:｜|（(、.。·—-]|$)/);
   if(phase)current=phase[1];
  }
  return current;
 }
 function context({phase,learning,qa=false}={}){const current=learning?.tasks?.[learning.currentTask];return {phase:phaseNames[phase]?phase:null,qa,resume:learning?.checkpoint&&learning.checkpoint.messageId===learning.lastAssistantId?String(learning.checkpoint.text||'').slice(0,240):'',task:current?{id:current.id,title:current.title,status:current.status}:null};}
 function taskText(c){return c.task?.title?`当前任务“${String(c.task.title).slice(0,120)}”`:'当前这一题';}
 function continueText(c={}){
  if(c.qa)return '请继续回答上一问未讲完的部分。';
  return {A:'请继续核对资料，齐全后开始精读。',B:'请从断点继续精读。',C:'请继续本讲总结；已总结完则制作复习卷。',D:'请继续完成复习卷。',E:'请继续批改我已提交的部分。',F:'保持本讲已完成，等待我的具体问题。'}[c.phase]||'请核对当前断点，再按学习规则继续。';
 }
 function skipText(c={}){if(c.phase&&!['B','E'].includes(c.phase))return null;return '跳过当前题，请直接讲解。';}
 function replyText(text){return String(text||'').trim();}
 const policyHeader='【学习规则更新 3.3.2】';
 function updateText(){return policyHeader+'请先读取项目中的新版学习规则，再处理本次请求。';}
 function withUpdate(text,c,needed){return needed&&!c.qa?text+'\n\n'+updateText(c):text;}
 function openLecture(course,request,previous,files=[]){return `开始“${course.name}｜${request.title}”。按项目学习规则，从本讲附件开始；上一讲仅作先修参考。${course.defaults?'\n课程要求：'+course.defaults:''}${request.note?'\n本讲要求：'+request.note:''}\n附件：${files.length?files.join('、'):'无'}。\n\n上一讲参考记录：\n${previous}`;}
 function qaBody(course,source,quote,question,id,metadata={}){return `【${course}｜统一问答】\n来源：${String(source.title||'当前讲次').slice(0,150)}\n${source.url}${source.anchor?'\n位置：'+String(source.anchor).slice(0,300):''}\n\n引用${metadata.truncated?'（节选）':''}：\n${quote||'未附引用'}\n\n问题：\n${question}\n\n请只回答本问。\n[问答定位码 ${id}]`;}
 root.AtelierPrompts={phaseNames,phaseFrom,context,continueText,skipText,replyText,withUpdate,updateText,policyHeader,openLecture,qaBody};
 if(typeof module!=='undefined')module.exports=root.AtelierPrompts;
})(globalThis);
