import './prompts.js';
export const stages = {A:'登记资料', B:'精读与主动证明', C:'系统总结', D:'法语复习卷', E:'解答批改', F:'已完成'};
export const uid = () => crypto.randomUUID();
export function lesson(course, title, mode='M') {
  return {id:uid(),course,title,mode,stage:'A',completed:[],materials:[],proofs:[],weak:[],notes:'',created:new Date().toISOString()};
}
export function transcript(input) {
  const raw=Array.isArray(input)?input:input?.segments;
  if(!Array.isArray(raw)||!raw.length) throw Error('需要非空 segments 数组，或分段数组。');
  let previous=-1;
  return raw.map((s,i)=>{
    if(typeof s.start!=='number'||typeof s.end!=='number'||!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<s.start||s.start<previous||typeof s.text!=='string') throw Error(`第 ${i+1} 段格式或时间顺序无效；需要 start/end 数字和 text 文本。`);
    previous=s.start;
    return {start:s.start,end:s.end,text:s.text,correction:'',note:'',evidence:'未核听'};
  });
}
export function time(s) {return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toFixed(1).padStart(4,'0')}`;}
export function coverage(l) {const total=l.materials.reduce((a,m)=>a+m.total,0);const done=l.materials.reduce((a,m)=>a+m.done.length,0);return {done,total,complete:total>0&&done===total};}
export function nextUnit(m) {for(let i=1;i<=m.total;i++) if(!m.done.includes(i)) return i;return null;}
export function validateBackup(s) {
  if(s?.version!==1||!Array.isArray(s.lessons))throw Error('备份格式或版本不支持。');
  const ids=new Set();
  if(s.trashedCourses!==undefined&&(!Array.isArray(s.trashedCourses)||s.trashedCourses.some(t=>!t||typeof t.id!=='string'||typeof t.courseId!=='string'||!Array.isArray(t.lessons)||!t.drafts||typeof t.drafts!=='object')))throw Error('回收站备份字段损坏。');
  for(const l of [...s.lessons,...(s.trashedCourses||[]).flatMap(t=>t.lessons)]){
    if(!l||typeof l.id!=='string'||ids.has(l.id)||typeof l.course!=='string'||typeof l.title!=='string'||!stages[l.stage]||!Array.isArray(l.completed)||!Array.isArray(l.materials)||!Array.isArray(l.proofs)||!Array.isArray(l.weak)) throw Error('备份课程字段损坏。');
    ids.add(l.id);
    for(const m of l.materials){
      if(typeof m.id!=='string'||ids.has(m.id)||typeof m.name!=='string'||!['pdf','image','transcript','text'].includes(m.kind)||!Number.isInteger(m.total)||m.total<1||!Number.isInteger(m.cursor)||m.cursor<1||m.cursor>m.total||!Array.isArray(m.done)||new Set(m.done).size!==m.done.length||m.done.some(n=>!Number.isInteger(n)||n<1||n>m.total))throw Error('备份资料字段损坏。');
      ids.add(m.id);
      if(m.kind==='transcript'&&transcript(m.segments).length!==m.total)throw Error('备份转写数量无效。');
      if(m.kind==='text'&&typeof m.text!=='string')throw Error('备份文本无效。');
    }
    if(l.proofs.some(p=>!p||typeof p.title!=='string'||typeof p.answer!=='string'||typeof p.feedback!=='string')||l.weak.some(w=>!w||typeof w.text!=='string'))throw Error('备份学习记录损坏。');
  }
  return s;
}
export function prompt(l,action,skill) {
 const P=globalThis.AtelierPrompts,c=coverage(l),m=l.materials.find(x=>x.id===l.selected),segment=m?.segments?.[m.cursor-1],ctx=P.context({phase:l.stage});
 const requests={continue:P.continueText(ctx),proof:'请批改下面实际提交的证明或小问，用中文解释判断和修正；未提交的部分保留待作答。',summary:'请基于本讲实际提供的资料做系统总结，按目标、结论的条件、依赖与证明方法组织；未覆盖资料另列为缺口，不标为精读完成。',exam:'请根据本讲已授范围生成全法语A4复习卷，给出可打印文件；只有题目，不附答案或提示。题面须完整说明对象、条件、符号与允许工具，小问按需要递进。',question:'请回答下方问题，先核对当前引用中的条件与对象；没有实际来源的补充需明确标注。'};
 const context=[`课程：${l.course}；讲次：${l.title}；当前阶段：${l.stage} ${stages[l.stage]}`,m?`来源：${m.name}，${m.kind==='transcript'?'第'+m.cursor+'段':'第'+m.cursor+'页/项'}，共${m.total}。`:'没有选择来源资料。',segment?`真实时间 ${time(segment.start)}–${time(segment.end)}；转写：${segment.text.slice(0,3000)}${segment.text.length>3000?'（节选）':''}；校正：${segment.correction||'无'}；核听：${segment.evidence}`:'',m?.kind==='text'?'当前文本'+(m.text.length>3000?'（节选）':'')+'：'+m.text.slice(0,3000):'',l.notes?'来源对应/备注：'+l.notes.slice(0,1500):'',`已确认覆盖 ${c.done}/${c.total}；覆盖记录不是附件已上传的证明。`,l.materialsPendingReview?'新增资料只作局部续接，保留原断点。':''].filter(Boolean);
 if(action==='proof')context.push(...l.proofs.filter(p=>p.status!=='已通过'&&p.answer?.trim()).map(p=>`题目：${p.title}\n我的证明：${p.answer}`));
 return context.join('\n')+'\n\n'+(requests[action]||requests.continue)+(action==='question'?'\n我的问题：':'')+'\n\n阶段未确认完成时不要自行跳转；已完成阶段按项目约定衔接。插件本地文件并未自动上传；缺少原始材料时请指出具体需要补什么。';
}
