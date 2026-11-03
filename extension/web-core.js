(function(root){
  'use strict';
  function conversation(value){try{const u=new URL(value);if(u.protocol!=='https:'||!['chatgpt.com','chat.openai.com'].includes(u.hostname))return null;const m=u.pathname.match(/\/c\/([a-z0-9-]{8,})(?:\/|$)/i);return m?{id:m[1],url:`https://chatgpt.com/c/${m[1]}`}:null;}catch{return null;}}
  function projectIdentity(value){try{const u=new URL(value);if(u.protocol!=='https:'||!['chatgpt.com','chat.openai.com'].includes(u.hostname))return null;const id=u.pathname.match(/^\/g\/(g-p-[^/]+)/)?.[1];return id?(id.match(/^(g-p-[0-9a-f]{32})(?:-|$)/i)?.[1]||id):null;}catch{return null;}}
  function project(value){if(!value)return '';const u=new URL(value);if(u.protocol!=='https:'||!['chatgpt.com','chat.openai.com'].includes(u.hostname)||!/^\/g\//.test(u.pathname))throw Error('项目地址应为 ChatGPT 项目页面的 https 地址。');const m=u.pathname.match(/^\/g\/(g-p-[^/]+)(?:\/|$)/);if(m){if(/\/c\//.test(u.pathname))throw Error('请使用项目页面地址，不要使用讲次对话地址。');return 'https://chatgpt.com/g/'+projectIdentity(value)+'/project';}return u.origin+u.pathname;}
  function messageRole(n){const legacy=n.closest('[data-message-author-role]')?.getAttribute('data-message-author-role');if(['user','assistant'].includes(legacy))return legacy;if(n.closest('[data-user-message-bubble="true"]'))return 'user';const unit=n.closest('[data-content-search-unit-key]');return unit?.getAttribute('data-content-search-unit-key')?.endsWith(':assistant')?'assistant':null;}
  function messageNodes(root=document){return [...root.querySelectorAll('[data-message-author-role],[data-user-message-bubble="true"],[data-chatgpt-selection-message-id]')].filter(n=>{if(!messageRole(n))return false;const legacy=n.closest('[data-message-author-role]');if(legacy&&legacy!==n)return false;const bubble=n.closest('[data-user-message-bubble="true"]');return !bubble||bubble===n;});}
  function messageId(n){return n.getAttribute('data-message-id')||n.closest('[data-message-id]')?.getAttribute('data-message-id')||n.getAttribute('data-chatgpt-selection-message-id')||n.closest('[data-chatgpt-selection-message-id]')?.getAttribute('data-chatgpt-selection-message-id')||(messageRole(n)==='user'&&n.closest('[data-content-search-turn-key]')?'user:'+n.closest('[data-content-search-turn-key]').getAttribute('data-content-search-turn-key'):null);}
  function messageText(n){return (n.querySelector('[data-search-result-target]')||n).textContent||'';}
  function messageMatchInfo(n,expected){
    const compact=s=>String(s||'').replace(/\s+/g,' ').trim(),want=compact(expected),tick=String.fromCharCode(96),bodies=[n],bubble=n.querySelector('[data-user-message-bubble="true"]');if(bubble)bodies.push(bubble);
    const marked=[...n.querySelectorAll('[data-search-result-target]')];if(marked.length){let common=marked[0];while(common&&marked.some(node=>!common.contains(node)))common=common.parentElement;if(common&&common!==n)bodies.push(common);}
    let renderedLength=0;for(const body of [...new Set(bodies)]){
      const raw=compact(body.textContent);
      if(want&&raw===want)return {matches:true,method:'exact-text',expectedLength:want.length,renderedLength:raw.length};
      const normalized=compact(rich(body).text);renderedLength=Math.max(renderedLength,normalized.length);
      if(want&&normalized===want)return {matches:true,method:'exact-rendered-text',expectedLength:want.length,renderedLength:normalized.length};
      if(String(expected||'').includes(tick)&&body.querySelector('code')){const clone=body.cloneNode(true);for(const code of clone.querySelectorAll('code'))if(!code.closest('pre'))code.replaceWith(code.ownerDocument.createTextNode(tick+code.textContent+tick));if(want&&(compact(clone.textContent)===want||compact(rich(clone).text)===want))return {matches:true,method:'exact-code-text',expectedLength:want.length,renderedLength:want.length};}
    }return {matches:false,method:'no-exact-match',expectedLength:want.length,renderedLength};
  }
  function messageMatches(n,expected){return messageMatchInfo(n,expected).matches;}
  const learningPolicyVersion='3.3.2';
  const learningPolicy='请按项目中的学习规则处理。';
  const skipProofPrompt='跳过当前题，请直接讲解。';
  function isSkipReply(text){return /^(?:跳过|跳过本题|跳过这题|跳过证明|跳过当前(?:这道|这)?(?:题|证明)(?:任务)?)[。！!\s]*$/.test(String(text||'').trim());}
  function awaitsReply(text){const records=[...String(text||'').matchAll(/\[LEARN:task:[a-z0-9][a-z0-9_-]{0,63}\][ \t]*(待作答|部分作答|待批改|提示中|已讲解|已完成)/ig)];if(records.length)return !['已讲解','已完成'].includes(records.at(-1)[1]);const tail=String(text||'').slice(-1000);if(/(?:没有|无|已无)待作答/.test(tail))return false;return /待作答|请先(?:独立)?(?:证明|完成|作答)|请独立证明|等待(?:你的|用户的)?(?:证明|作答|回答|答卷|解答)|待提交|请(?:按题号|逐题|先)?提交(?:证明|答案|解答)|进入\s*E[（(]等待答卷/.test(tail);}
  function hash(text){let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return (h>>>0).toString(36);}
  function connectionMessage(error,target='background'){
    const message=String(error?.message||error||'');
    if(/extension context invalidated/i.test(message))return '插件刚刚更新，当前页面仍连接旧版本。请刷新 ChatGPT 网页，并关闭后重新打开插件侧栏。';
    if(/receiving end does not exist|could not establish connection/i.test(message))return target==='page'?'ChatGPT 网页尚未连接插件。请刷新对应讲次和统一问答区的网页，再重试；仅重新加载插件还不够。':'插件后台未连接。请在扩展管理页重新加载插件，再刷新 ChatGPT 网页，并关闭后重新打开插件侧栏。';
    if(/no tab with id|invalid tab id/i.test(message))return '原对话标签页已关闭。请重新打开对应讲次的 ChatGPT 网页。';
    if(/message (port|channel).*closed|port closed/i.test(message))return '连接在操作期间中断。请先核对原对话是否已经发送，避免重复提交；再刷新网页并重新打开插件侧栏。';
    return message;
  }
  async function runtimeCall(type,extra={}){
    if(!globalThis.chrome?.runtime?.sendMessage)throw Error('请在浏览器扩展内使用此功能。');
    const readOnly=new Set(['MA_CONFIG','MA_LOOKUP','MA_CURRENT','MA_READER_TARGET','MA_TAB_STATUS','MA_EXPORT_WEB','MA_QA_RESULT','MA_QA_PENDING']);
    for(let attempt=0;;attempt++){
      let reply;try{reply=await chrome.runtime.sendMessage({type,...extra});}catch(e){if(readOnly.has(type)&&attempt<2&&/receiving end does not exist|could not establish connection/i.test(String(e?.message))){await new Promise(r=>setTimeout(r,attempt?400:150));continue;}throw Error(connectionMessage(e));}
      if(!reply?.ok)throw Error(reply?.error?connectionMessage(reply.error):'插件后台未返回有效结果。请关闭并重新打开插件侧栏。');return reply.data;
    }
  }
  function mergeMessages(previous,incoming){const ordered=previous.map(m=>m.id),map=new Map(previous.map(m=>[m.id,m]));for(let i=0;i<incoming.length;i++){const m=incoming[i];if(!map.has(m.id)){let at=-1;for(let j=i+1;j<incoming.length;j++){const n=ordered.indexOf(incoming[j].id);if(n>=0){at=n;break;}}if(at<0&&i>0){const n=ordered.indexOf(incoming[i-1].id);if(n>=0)at=n+1;}ordered.splice(at<0?ordered.length:at,0,m.id);}map.set(m.id,m);}return ordered.map(id=>map.get(id));}
  const htmlTags=new Set('p div span h1 h2 h3 h4 h5 h6 strong b em i u s del sub sup pre code ul ol li blockquote table thead tbody tr td th hr br a details summary'.split(' '));
  const mathTags=new Set('math semantics annotation mrow mi mn mo mtext mspace ms mfrac msqrt mroot mstyle merror mpadded mphantom mfenced menclose msub msup msubsup munder mover munderover mmultiscripts mprescripts none mtable mtr mtd maligngroup malignmark'.split(' '));
  const mathAttrs=new Set('display mathvariant stretchy fence separator form accent accentunder largeop movablelimits symmetric lspace rspace minsize maxsize linethickness columnalign rowalign columnspacing rowspacing columnspan rowspan notation width height depth voffset encoding'.split(' '));
  function sanitize(node,doc=document){
    const out=doc.createDocumentFragment();
    function visit(n,parent){
      if(n.nodeType===3){parent.append(doc.createTextNode(n.textContent));return;}if(n.nodeType!==1)return;
      const tag=n.localName.toLowerCase();if(['script','style','iframe','object','embed','img','svg','video','audio','button','input','textarea','noscript'].includes(tag))return;
      if(n.classList?.contains('katex-html'))return;
      if(n.classList?.contains('katex')){const math=n.querySelector('math');if(math){visit(math,parent);return;}}
      if(!htmlTags.has(tag)&&!mathTags.has(tag)){for(const ch of n.childNodes)visit(ch,parent);return;}
      const e=mathTags.has(tag)?doc.createElementNS('http://www.w3.org/1998/Math/MathML',tag):doc.createElement(tag);
      if(mathTags.has(tag)){for(const a of n.attributes)if(mathAttrs.has(a.name)&&a.value.length<150)e.setAttribute(a.name,a.value);}
      if(tag==='a'){try{const url=new URL(n.getAttribute('href'),location.href);if(['https:','http:'].includes(url.protocol)){e.href=url.href;e.target='_blank';e.rel='noopener noreferrer';}}catch{}}
      for(const ch of n.childNodes)visit(ch,e);parent.append(e);
    }
    for(const ch of node.childNodes)visit(ch,out);return out;
  }
  function plain(node){if(node.nodeType===3)return node.textContent;if(node.nodeType!==1&&node.nodeType!==11)return '';if(node.nodeType===1&&node.localName==='math'){const a=node.querySelector('annotation[encoding="application/x-tex"]');if(a)return `${node.getAttribute('display')==='block'?'\n\\[':'\\('}${a.textContent}${node.getAttribute('display')==='block'?'\\]\n':'\\)'}`;}
    const text=[...node.childNodes].map(plain).join('');return /^(p|div|h[1-6]|li|tr|pre|br)$/.test(node.localName||'')?text+'\n':text;}
  function rich(node){const wrapper=document.createElement('div');wrapper.append(sanitize(node));return {html:wrapper.innerHTML,text:plain(wrapper).trim()};}
  function mountHTML(target,html){const template=document.createElement('template');template.innerHTML=String(html||'');target.replaceChildren(sanitize(template.content));}
  const outlineKinds={definition:'定义',theorem:'定理',lemma:'引理',proposition:'命题',corollary:'推论',property:'性质',axiom:'公理',notation:'记号',example:'例子',counterexample:'反例',remark:'注记',proof:'证明',exercise:'习题',section:'章节'};
  const outlineRules=[['counterexample','反例|contre[- ]exemple|counterexample'],['definition','定义|définition|definition'],['theorem','定理|théorème|theorem'],['lemma','引理|lemme|lemma'],['proposition','命题|proposition'],['corollary','推论|corollaire|corollary'],['property','性质|propriété|property'],['axiom','公理|axiome|axiom'],['notation','记号|符号约定|notation'],['example','例子|示例|例|exemple|example'],['remark','注记|备注|注意|remarque|remark'],['proof','证明|démonstration|preuve|proof'],['exercise','习题|练习|exercice|exercise']];
  const compact=s=>String(s||'').normalize('NFC').replace(/\s+/g,' ').trim();
  function outlineKind(text,heading=false){
    const clean=compact(text).replace(/^#{1,6}\s*/,'').replace(/^(?:(?:第[一二三四五六七八九十百\d]+[章节部分]+|[（(]?(?:\d+(?:\.\d+)*|[一二三四五六七八九十百]+)[）)]?)[、.．:：)\s-]+)+/,'').replace(/^(?:关键|重要|核心|基本|标准|正式|主动|补充)\s*/,'');
    if(/^(?:定理|引理|命题).{0,35}(?:的证明|证明思路|证明策略)/.test(clean))return 'proof';
    for(const [kind,words] of outlineRules){const prefix=new RegExp(`^(?:${words})`,'iu'),match=clean.match(prefix);if(!match)continue;const rest=clean.slice(match[0].length);if(/^[a-zà-ÿ]/iu.test(rest)||(match[0]==='例'&&rest&&!/^[\s\d:：.。()（）]/u.test(rest)))continue;if(heading||/^(?:\s*(?:\d+(?:\.\d+)*|[IVX]+))?\s*(?:[:：。()（）]|\.(?!\d)|$)/u.test(rest)||/^\s+[^:：.!?。]{1,65}[:：]/u.test(rest))return kind;}
    return heading?'section':null;
  }
  function nodePath(root,n){const path=[];for(let p=n;p&&p!==root;p=p.parentElement){const parent=p.parentElement;if(!parent)return null;path.unshift([...parent.children].indexOf(p));if(path.length>40)return null;}return path;}
  function scanOutline(root){
    const result=[],counts={};
    for(const n of root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,dt,strong,b')){
      if(n.closest('pre,code,table,script,style,.katex,.katex-html'))continue;
      const heading=/^h[1-6]$/i.test(n.tagName),raw=compact(n.textContent);if(!raw)continue;
      // Prefer a containing heading, paragraph or list item over nested bold labels.
      if(!heading&&n.closest('h1,h2,h3,h4,h5,h6'))continue;
      if(!heading&&/^(STRONG|B)$/.test(n.tagName)&&n.closest('p,li,dt'))continue;
      if(!heading&&n.matches('li')&&n.querySelector('p,h1,h2,h3,h4,h5,h6'))continue;
      const kind=outlineKind(raw,heading);if(!kind)continue;
      const label=compact(rich(n).text).slice(0,180),path=nodePath(root,n);if(!label||!path)continue;
      const kindIndex=counts[kind]||0;counts[kind]=kindIndex+1;
      result.push({node:n,kind,label,kindIndex,order:result.length,path,level:heading?Number(n.tagName.slice(1)):7});
    }
    return result;
  }
  function outlineEntries(root){return scanOutline(root).map(({node,...entry})=>entry);}
  function resolveOutline(root,entry){const list=scanOutline(root),same=(a,b)=>{a=compact(a);b=compact(b);return a===b||a.startsWith(b)||b.startsWith(a);};const exact=list.find(e=>e.kind===entry.kind&&e.kindIndex===entry.kindIndex&&same(e.label,entry.label));if(exact)return exact.node;const matches=list.filter(e=>e.kind===entry.kind&&same(e.label,entry.label));if(matches.length===1)return matches[0].node;return null;}
  const qaQuoteLimit=3000;
  function safeQuoteCut(raw,end){
    for(const m of raw.matchAll(/\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|(?<!\\)\$[^$\n]*?(?<!\\)\$/g)){if(m.index<end&&m.index+m[0].length>end){end=m.index;break;}}
    const prefix=raw.slice(0,end),boundary=Math.max(prefix.lastIndexOf('\n'),prefix.lastIndexOf('。')+1,prefix.lastIndexOf('；')+1);if(boundary>0&&boundary>=end-600)end=boundary;
    if(/[\uD800-\uDBFF]$/.test(raw.slice(0,end)))end--;return raw.slice(0,end).trimEnd();
  }
  function centeredQuote(raw){
    let start=Math.max(0,Math.floor((raw.length-qaQuoteLimit)/2));
    for(const m of raw.matchAll(/\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|(?<!\\)\$[^$\n]*?(?<!\\)\$/g)){if(m.index<start&&m.index+m[0].length>start){if(m[0].length>qaQuoteLimit)return '';start=m.index;break;}}
    if(start>0&&/[\uDC00-\uDFFF]/.test(raw[start]))start--;return safeQuoteCut(raw.slice(start),qaQuoteLimit);
  }
  function qaQuote(value){const raw=String(value||'').trim(),truncated=raw.length>qaQuoteLimit;return {text:truncated?safeQuoteCut(raw,qaQuoteLimit):raw,truncated,originalLength:raw.length};}
  function quoteUnits(units,focus=0){
    units=units.filter(u=>u.text?.trim());const originalLength=units.map(u=>u.text).join('\n\n').length;if(!units.length)return {...qaQuote(''),contextAdded:false};focus=Math.max(0,Math.min(focus,units.length-1));
    if(units[focus].text.length>qaQuoteLimit){const unit=units[focus];return {text:unit.protected?'':centeredQuote(unit.text),truncated:true,originalLength,contextAdded:!!unit.contextAdded,notice:unit.protected?'当前完整陈述超过引用上限，请选取所需条件与小问；未截断公式或定理陈述。':'当前段落过长，已保留阅读中心附近的完整片段。'};}
    let left=focus,right=focus,length=units[focus].text.length,goLeft=true,goRight=true;while(goLeft||goRight){if(goLeft){if(left>0&&length+2+units[left-1].text.length<=qaQuoteLimit){length+=2+units[--left].text.length;}else goLeft=false;}if(goRight){if(right+1<units.length&&length+2+units[right+1].text.length<=qaQuoteLimit){length+=2+units[++right].text.length;}else goRight=false;}}
    const selected=units.slice(left,right+1);return {text:selected.map(u=>u.text).join('\n\n'),truncated:left>0||right<units.length-1,originalLength,contextAdded:selected.some(u=>u.contextAdded)};
  }
  function readingQuote(root=document,top,bottom){
    const doc=root.ownerDocument||root,win=doc.defaultView,viewport=win.visualViewport;
    const bounds={top:top??viewport?.offsetTop??0,bottom:bottom??((viewport?.offsetTop||0)+(viewport?.height||win.innerHeight)),left:viewport?.offsetLeft||0,right:(viewport?.offsetLeft||0)+(viewport?.width||win.innerWidth)};
    const nodes=root.nodeType===1&&messageRole(root)==='assistant'?[root]:messageNodes(root).filter(n=>messageRole(n)==='assistant');
    if(nodes.length){for(let p=nodes[0].parentElement;p&&p!==doc.body;p=p.parentElement){if(/auto|scroll/.test(win.getComputedStyle(p).overflowY)&&p.scrollHeight>p.clientHeight+5){const r=p.getBoundingClientRect();bounds.top=Math.max(bounds.top,r.top);bounds.bottom=Math.min(bounds.bottom,r.bottom);bounds.left=Math.max(bounds.left,r.left);bounds.right=Math.min(bounds.right,r.right);break;}}}
    const center=nodes[0]?.getBoundingClientRect();
    for(const header of doc.querySelectorAll('header,#page-header,[data-testid="conversation-header"]')){const r=header.getBoundingClientRect();if(r.height>0&&r.top<=bounds.top+20&&r.bottom<bounds.bottom&&r.width>(center?.width||win.innerWidth)*0.5&&(!center||r.left<center.right&&r.right>center.left))bounds.top=Math.max(bounds.top,r.bottom);}
    const composer=doc.querySelector('#prompt-textarea,textarea[data-testid="prompt-textarea"]');if(composer){const form=composer.closest('form')||composer,r=form.getBoundingClientRect();if(r.height>0&&r.top>bounds.top&&r.top<bounds.bottom)bounds.bottom=r.top;}
    const quoteText=n=>rich(n).text.replace(/\[MATH:(?:def|thm|prop|cor|lem):[a-z0-9_-]+\]/ig,'').replace(/^\[LEARN:[^\n]*$/gm,'').trim();
    const intersects=r=>r.bottom>bounds.top&&r.top<bounds.bottom&&r.right>bounds.left&&r.left<bounds.right;
    function visibleClone(n){
      if(n.nodeType===3){const raw=n.textContent;if(!raw)return null;const range=doc.createRange();range.selectNodeContents(n);const rects=[...range.getClientRects()];if(!rects.some(intersects))return null;
        if(rects.every(r=>r.top>=bounds.top&&r.bottom<=bounds.bottom&&r.left>=bounds.left&&r.right<=bounds.right))return doc.createTextNode(raw);
        const charRect=i=>{range.setStart(n,i);range.setEnd(n,Math.min(i+1,raw.length));return [...range.getClientRects()].find(r=>r.width>0)||range.getBoundingClientRect();};
        let low=0,high=raw.length;while(low<high){const mid=(low+high)>>1;if(charRect(mid).bottom<=bounds.top)low=mid+1;else high=mid;}let start=low;low=start;high=raw.length;while(low<high){const mid=(low+high)>>1;if(charRect(mid).top<bounds.bottom)low=mid+1;else high=mid;}let end=low;
        while(start<end&&!intersects(charRect(start)))start++;while(end>start&&!intersects(charRect(end-1)))end--;if(start>0&&/[\uDC00-\uDFFF]/.test(raw[start]))start--;if(end<raw.length&&/[\uD800-\uDBFF]/.test(raw[end-1]))end++;return end>start?doc.createTextNode(raw.slice(start,end)):null;
      }
      if(n.nodeType!==1||n.hidden||n.matches('script,style,button,input,textarea,pre')||win.getComputedStyle(n).visibility==='hidden')return null;
      if(![...n.getClientRects()].some(intersects))return null;
      if(n.matches('math,.katex'))return n.cloneNode(true);
      const clone=n.cloneNode(false);for(const ch of n.childNodes){const child=visibleClone(ch);if(child)clone.append(child);}return clone.childNodes.length||n.matches('br')?clone:null;
    }
    const parts=[];let anchor='',lastFormal=null;const focusY=(bounds.top+bounds.bottom)/2;for(const message of nodes){if(![...message.getClientRects()].some(intersects))continue;lastFormal=null;const candidates=[...message.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,tr,math[display="block"],.katex-display')],formalByNode=new Map(),emittedGroups=new Set();let group=null;
      for(const n of candidates){if(n.matches('p,li,math,.katex-display')&&n.closest('table')||n.matches('li')&&n.querySelector('p')||n.matches('math,.katex-display')&&n.parentElement.closest('p,li,.katex-display'))continue;const t=n.textContent.trim();if(/^证明(?:[（(:：。\s]|$)/.test(t))group=null;if(/^H[1-6]$/.test(n.tagName)){if(/定义|定理|命题|推论|引理/.test(t)&&!/证明|回顾|习题/.test(t))group={nodes:[],level:Number(n.tagName[1]),heading:n};else if(!group||Number(n.tagName[1])<=group.level||/证明|习题/.test(t))group=null;}if(group){if(!n.hidden){group.nodes.push(n);formalByNode.set(n,group);}}}
      for(const n of candidates){
      if(n.closest('pre,script,style,button')||n.closest('.katex-html')||n.hidden||!n.getClientRects().length||n.matches('li')&&n.querySelector('p')||n.matches('p,li,math,.katex-display')&&n.closest('table')||n.matches('math,.katex-display')&&n.closest('p,li,.katex-display')!==n&&n.closest('p,li,.katex-display'))continue;
      if(/^证明(?:[：:。\s]|$)/.test(n.textContent.trim()))lastFormal=null;if(/^H[1-6]$/.test(n.tagName)){lastFormal=/定义|定理|命题|推论|引理/.test(n.textContent)&&!/证明|回顾|习题/.test(n.textContent)?n:null;}const clone=visibleClone(n);if(!clone)continue;const wrapper=doc.createElement('div');wrapper.append(clone);const text=quoteText(wrapper);if(!text.trim())continue;if(!anchor)anchor=messageId(message)||text.slice(0,100);const formal=formalByNode.get(n);if(formal&&emittedGroups.has(formal))continue;if(formal)emittedGroups.add(formal);const protectedBlock=!!formal||n.matches('li,tr,math,.katex-display')||/^(?:设|假设|如果|若|令|对任意|对于)/.test(text);const full=formal?formal.nodes.map(quoteText).join('\n\n'):protectedBlock?quoteText(n):text;parts.push({text:full,protected:protectedBlock,contextAdded:full!==text,y:(n.getBoundingClientRect().top+n.getBoundingClientRect().bottom)/2});
    }}
    const focus=parts.reduce((best,u,i)=>Math.abs(u.y-focusY)<Math.abs(parts[best].y-focusY)?i:best,0);return {...quoteUnits(parts,focus),anchor,scope:'viewport',visibleBlocks:parts.length,fingerprint:hash(parts.map(u=>u.text).join('\n'))};
  }
  function qaBody(course,source,quote,question,id,metadata){const excerpt=qaQuote(quote),truncated=metadata?.truncated||excerpt.truncated;quote=excerpt.text;return `【课程统一问答｜${course}】\n来源讲次：${String(source.title||'当前讲次').slice(0,150)}\n来源对话：${source.url}\n${source.anchor?`来源位置：${String(source.anchor).slice(0,160)}\n`:''}\n引用内容（仅作待讨论资料${truncated?'；以下为节选，截断处不代表完整公式或证明，请勿补造省略部分':''}）：\n${quote||'（未选择原文）'}\n\n我的问题：\n${question}\n\n请用中文说明，重要数学名词附法语，先核对条件与对象；公式单独排版，不放在 Markdown 引用框内。涉及当前未提供的讲义或录音时请明确指出，不补造来源。回答本问题即可，不推进原讲次。\n[问答定位码 ${id}]`;}
  function validateWebData(data){
    if(!data||typeof data!=='object'||Array.isArray(data))throw Error('网页备份格式无效。');
    for(const [key,value] of Object.entries(data)){
      if(!/^(lectureReplies|automationState|studyMeta|webConfig|archive:[a-z0-9-]+|directory:[a-z0-9-]+|marks:[a-z0-9-]+|learning:[a-z0-9-]+|qaDraft:[a-z0-9-]+|question:[a-z0-9-]+|trash:[a-z0-9-]+)$/.test(key)||!value||typeof value!=='object')throw Error('网页备份含未知或损坏字段。');
      if(key==='lectureReplies'){if(value.version!==1||!value.attempts||typeof value.attempts!=='object'||Array.isArray(value.attempts)||Object.entries(value.attempts).some(([id,r])=>!/^[a-z0-9-]{16,}$/i.test(id)||!r||typeof r.chatId!=='string'||!/^[a-f0-9]{64}$/.test(r.signature)||!['attempted','sent'].includes(r.status)||!Number.isFinite(r.updated)))throw Error('本讲回复记录无效。');}else if(key==='automationState'){if(!value.operations||typeof value.operations!=='object'||Array.isArray(value.operations)||Object.values(value.operations).some(o=>!o||typeof o.id!=='string'||!['course','lecture','qa'].includes(o.kind)||!['running','blocked','done'].includes(o.status)||!o.request||typeof o.request!=='object'))throw Error('创建流程记录无效。');}else if(key==='studyMeta'){if(Object.entries(value).some(([k,v])=>k==='completedTasks'?(!Array.isArray(v)||v.some(x=>typeof x!=='string')):(typeof v!=='number'||!Number.isFinite(v)||v<0)))throw Error('备份提醒记录无效。');}else if(key==='webConfig'){
        if(!Array.isArray(value.courses))throw Error('网页课程设置损坏。');
        for(const c of value.courses){if(typeof c.id!=='string'||typeof c.name!=='string'||!Array.isArray(c.lectures)||(c.qaUrl&&!conversation(c.qaUrl)))throw Error('课程链接或字段无效。');if(c.previousQaUrls&&(!Array.isArray(c.previousQaUrls)||c.previousQaUrls.some(u=>!conversation(u))))throw Error('往期问答链接无效。');project(c.projectUrl);for(const l of c.lectures)if(typeof l.title!=='string'||!conversation(l.url))throw Error('讲次链接无效。');}
      }else if(key.startsWith('learning:')){if(value.version!==1||!value.tasks||typeof value.tasks!=='object'||Array.isArray(value.tasks)||Object.entries(value.tasks).some(([id,t])=>!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)||!t||typeof t.title!=='string'||typeof t.statement!=='string'||typeof t.tools!=='string'||!Array.isArray(t.subquestions)||t.subquestions.some(s=>typeof s!=='string')))throw Error('学习状态记录损坏。');}else if(key.startsWith('qaDraft:')){if(typeof value.question!=='string'||typeof value.quote!=='string')throw Error('提问草稿损坏。');}else if(key.startsWith('trash:')){
        if(typeof value.id!=='string'||!value.course||!value.records||typeof value.records!=='object'||Object.keys(value.records).some(k=>k==='webConfig'||k.startsWith('trash:')))throw Error('回收站记录无效。');
        validateWebData({webConfig:{courses:[value.course]}});validateWebData(value.records);
      }else if(key.startsWith('archive:')){
        if(conversation(value.url)?.id!==key.slice(8)||typeof value.title!=='string'||!Array.isArray(value.messages)||value.messages.some(m=>typeof m.id!=='string'||typeof m.text!=='string'||typeof m.html!=='string'||!['user','assistant'].includes(m.role)))throw Error('阅读本记录无效。');
      }else if(key.startsWith('directory:')){
        if(conversation(value.url)?.id!==key.slice(10)||!Array.isArray(value.messages)||value.messages.some(m=>typeof m.id!=='string'||!Array.isArray(m.entries)||m.entries.some(e=>!outlineKinds[e.kind]||typeof e.label!=='string'||!Number.isInteger(e.kindIndex))))throw Error('数学目录记录无效。');
      if(value.corrections&&Object.values(value.corrections).some(k=>!outlineKinds[k]&&k!=='hidden'))throw Error('目录纠正记录无效。');}else if(key.startsWith('marks:')){
        if(!Array.isArray(value.items)||value.items.some(p=>typeof p.key!=='string'||typeof p.name!=='string'))throw Error('书签记录无效。');
      }else if(!conversation(value.source)||!conversation(value.target)||typeof value.question!=='string'||typeof value.body!=='string'||(value.answer&&(typeof value.answer.html!=='string'||typeof value.answer.text!=='string')))throw Error('问答记录无效。');
    }
    return data;
  }
  const api={conversation,project,projectIdentity,messageRole,messageNodes,messageId,messageText,messageMatches,messageMatchInfo,awaitsReply,learningPolicyVersion,learningPolicy,skipProofPrompt,isSkipReply,hash,mergeMessages,sanitize,rich,plain,mountHTML,qaBody,validateWebData,connectionMessage,runtimeCall,outlineKinds,outlineKind,outlineEntries,scanOutline,resolveOutline,qaQuoteLimit,qaQuote,quoteUnits,readingQuote};root.MathAtelier=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
