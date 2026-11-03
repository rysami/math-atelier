(function(root){
  'use strict';
  const key=id=>`newChat:${id}`;
  async function open(courseId,kind='lecture',title='新讲次',lessonId){
    if(!['qa','lecture'].includes(kind))throw Error('聊天类型无效。');
    const cfg=await config(),course=cfg.courses.find(c=>c.id===courseId);
    if(!course)throw Error('课程已不存在，请重新选择。');
    if(lessonId){const main=await AtelierLocalStore.readMain();if(!main.lessons.some(l=>l.id===lessonId&&l.courseId===courseId))throw Error('本地讲次已变化，请重新选择。');}
    if(kind==='qa'&&course.qaUrl)throw Error('这门课程已有统一问答区，请使用原问答区。');
    // Use the normal webpage; no private API and no automatic message submission.
    const tab=await chrome.tabs.create({url:course.projectUrl||'https://chatgpt.com/',active:true});
    try{await chrome.storage.session.set({[key(tab.id)]:{courseId,kind,lessonId:lessonId||null,title:String(title||'新讲次').slice(0,120),created:Date.now()}});}catch(e){throw Error('新聊天页面已打开，但自动绑定登记失败。请在资料与设置中手动绑定。');}
    return {tabId:tab.id,project:!!course.projectUrl};
  }
  async function bind(tabId,url){const chat=MathAtelier.conversation(url);if(!chat)return;return serial(async()=>{
    const task=(await chrome.storage.session.get(key(tabId)))[key(tabId)];if(!task)return;
    const cfg=await config(),course=cfg.courses.find(c=>c.id===task.courseId);
    if(!course||Date.now()-task.created>20*60*1000){await chrome.storage.session.remove(key(tabId));return;}
    const owner=cfg.courses.find(c=>MathAtelier.conversation(c.qaUrl)?.id===chat.id||c.lectures.some(l=>MathAtelier.conversation(l.url)?.id===chat.id));
    if(owner){await chrome.storage.session.remove(key(tabId));return;}
    if(task.kind==='qa'){if(course.qaUrl){await chrome.storage.session.remove(key(tabId));return;}course.qaUrl=chat.url;}
    else course.lectures.push({title:task.title,url:chat.url,lessonId:task.lessonId||null,autoTitle:/^(新讲次|第一讲|课程讲次)$/.test(task.title)});
    cfg.ignoredChatIds=(cfg.ignoredChatIds||[]).filter(id=>id!==chat.id);
    await chrome.storage.local.set({webConfig:cfg});await chrome.storage.session.remove(key(tabId));AtelierCourses.announce({chatCreated:chat.id,courseId:course.id});
  });}
  chrome.tabs.onUpdated.addListener((id,change,tab)=>{if(change.url||change.status==='complete')bind(id,change.url||tab.url).catch(console.error);});
  chrome.tabs.onRemoved.addListener(id=>{chrome.storage.session.remove(key(id)).catch(()=>{});});
  root.AtelierNewChat={open,bind};
})(globalThis);
