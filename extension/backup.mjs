import './web-core.js';
const M=MathAtelier;
export function previewBackup(current,incoming){
 const local=new Set(current.lessons.map(l=>l.id));
 return {existing:current.lessons.length,incoming:incoming.lessons.length,conflicts:incoming.lessons.filter(l=>local.has(l.id)).length,newLessons:incoming.lessons.filter(l=>!local.has(l.id)).length,files:AtelierLocalStore.fileMaterials(incoming).length};
}
export function mergeWeb(current,incoming){
 const out={...current};
 for(const [key,value] of Object.entries(incoming||{})){
  if(!out[key]){out[key]=value;continue;}
  if(key.startsWith('archive:')||key.startsWith('directory:'))out[key]={...value,...out[key],messages:M.mergeMessages(value.messages||[],out[key].messages||[])};
 }
 if(incoming?.webConfig){const cfg=structuredClone(current.webConfig||{courses:[]});for(const c of incoming.webConfig.courses){const old=cfg.courses.find(x=>x.id===c.id);if(!old)cfg.courses.push(c);else for(const l of c.lectures)if(!old.lectures.some(x=>M.conversation(x.url)?.id===M.conversation(l.url)?.id))old.lectures.push(l);}const ids=new Set(cfg.courses.map(c=>c.id)),chatIds=new Set(cfg.courses.flatMap(c=>[c.qaUrl,...c.lectures.map(l=>l.url)]).map(u=>M.conversation(u)?.id));cfg.deletedCourseIds=(cfg.deletedCourseIds||[]).filter(id=>!ids.has(id));cfg.ignoredChatIds=(cfg.ignoredChatIds||[]).filter(id=>!chatIds.has(id));out.webConfig=cfg;}
 return out;
}
export function restoreChoice(summary){return new Promise(resolve=>{
 const dialog=document.createElement('dialog'),title=document.createElement('h2'),p=document.createElement('p');title.textContent='备份导入预览';p.textContent=`本机 ${summary.existing} 讲；备份 ${summary.incoming} 讲、${summary.files} 份文件；新增 ${summary.newLessons} 讲；同标识 ${summary.conflicts} 讲。合并保留本机同标识记录及发送状态。替换使用备份全部记录。导入前自动建立恢复点。`;dialog.append(title,p);
 for(const [label,value] of [['合并（保留本机冲突项）','merge'],['替换全部记录','replace'],['取消',null]]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>{dialog.close();dialog.remove();resolve(value);};dialog.append(b);}
 dialog.oncancel=e=>{e.preventDefault();dialog.close();dialog.remove();resolve(null);};document.body.append(dialog);dialog.showModal();
});}
