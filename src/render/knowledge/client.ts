// Embedded verbatim in the offline HTML. No network requests or external runtime.
export const KNOWLEDGE_CLIENT = String.raw`
'use strict';
(() => {
  const data = JSON.parse(document.getElementById('data').textContent);
  const $ = id => document.getElementById(id);
  const svg = $('graph'), edgeLayer = $('edges'), vertexLayer = $('vertices');
  const NS = 'http://www.w3.org/2000/svg';
  let nodes = [], edges = [], selected = null, box = {x:-500,y:-350,w:1000,h:700};
  let drag = null, moved = false;
  const cut = (text, n) => text.length > n ? text.slice(0,n-1) + '…' : text;
  const title = row => row[3] === null ? '(no prompt)' : row[3];
  const pathIds = row => [...new Set([...row[6],...row[7],...(row[8] || [])])];
  const make = (tag, attrs = {}, text) => {
    const el = document.createElementNS(NS,tag);
    Object.entries(attrs).forEach(([key,value]) => el.setAttribute(key,String(value)));
    if (text !== undefined) el.textContent = text;
    return el;
  };
  function view() { svg.setAttribute('viewBox',[box.x,box.y,box.w,box.h].join(' ')); }
  function fit() {
    if (!nodes.length) return;
    const xs=nodes.map(n=>n.x), ys=nodes.map(n=>n.y);
    let x=Math.min(...xs)-70, y=Math.min(...ys)-85;
    let w=Math.max(...xs)-x+130, h=Math.max(...ys)-y+115;
    const ratio=svg.clientWidth/Math.max(1,svg.clientHeight);
    if (w/h < ratio) { const nw=h*ratio; x-=(nw-w)/2; w=nw; }
    else { const nh=w/ratio; y-=(nh-h)/2; h=nh; }
    box={x,y,w:Math.max(w,200),h:Math.max(h,200)}; view();
  }
  function zoom(scale, point) {
    const p=point || {x:box.x+box.w/2,y:box.y+box.h/2};
    const w=Math.max(60,Math.min(20000,box.w*scale));
    const factor=w/box.w;
    box={x:p.x-(p.x-box.x)*factor,y:p.y-(p.y-box.y)*factor,w,h:box.h*factor}; view();
  }
  function point(event) {
    const matrix=svg.getScreenCTM();
    if (!matrix) return {x:0,y:0};
    const p=svg.createSVGPoint(); p.x=event.clientX; p.y=event.clientY;
    return p.matrixTransform(matrix.inverse());
  }
  function selectedNeighbors() {
    const ids=new Set(selected ? [selected] : []);
    if (selected) edges.forEach(e=>{if(e.a.id===selected)ids.add(e.b.id);if(e.b.id===selected)ids.add(e.a.id);});
    return ids;
  }
  function highlight() {
    const related=selectedNeighbors(), narrow=$('neighbors').checked && selected;
    nodes.forEach(n=>{
      n.el.classList.toggle('selected',n.id===selected);
      n.el.style.display=narrow && !related.has(n.id)?'none':'';
      n.el.setAttribute('aria-pressed',String(n.id===selected));
      n.button.hidden=Boolean(narrow && !related.has(n.id));
      n.button.setAttribute('aria-pressed',String(n.id===selected));
    });
    edges.forEach(e=>{
      const connected=e.a.id===selected || e.b.id===selected;
      e.el.classList.toggle('highlight',connected);
      e.el.style.display=narrow && !connected?'none':'';
    });
  }
  function text(tag, value, className) {
    const el=document.createElement(tag); el.textContent=value;
    if(className)el.className=className;
    $('inspector').append(el); return el;
  }
  function list(label, refs, outside=false) {
    text('h3',label);
    if(refs===null) {text('p','Not measured: no declared comparison, or still running.','muted');return;}
    if(!refs.length) {text('p','None recorded.','muted');return;}
    const ul=document.createElement('ul');
    refs.forEach(i=>{const li=document.createElement('li');li.textContent=(outside?'! ':'')+data.paths[i];if(outside)li.className='drift';ul.append(li);});
    $('inspector').append(ul);
  }
  function inspect(id) {
    selected=id; highlight(); $('inspector').replaceChildren();
    const node=nodes.find(n=>n.id===id);
    if(!node) {text('p','INSPECT','eyebrow');text('h2','Every connection has a record.');text('p','Select a session or path to inspect its evidence.');return;}
    text('p',node.type==='session'?'SESSION':'PATH','eyebrow');
    if(node.type==='session') {
      const row=data.sessions[node.ref];
      text('h2',title(row));
      text('p',row[5]+' · '+row[4]+(row[2]===null?' · running':''),'muted');
      text('p','Intent is immutable record text.');
      list('DECLARED SCOPE',row[6]);list('CHANGED PATHS',row[7]);list('OUTSIDE SCOPE',row[8],true);
      if(row[10]!==null)list('ORIGINAL PRIME PROPOSAL',row[10]);
      text('h3','EVIDENCE');text('p','ID '+row[0]+'\nStarted '+row[1]+'\nEnded '+(row[2]||'still running')+'\nStart commit '+row[9],'muted');
      text('p','More detail: session week '+row[0]+' --full','muted');
      if(row[2]===null)text('p','Changed paths are recorded at stop, not a live working-tree diff.','muted');
    } else {
      text('h2',data.paths[node.ref]);
      text('p','A literal path from a record. A scope entry may be a directory prefix; an edge is not a dependency.','muted');
      text('h3','RELATED SESSIONS IN THIS SNAPSHOT');
      data.sessions.forEach((row,i)=>{
        if(!pathIds(row).includes(node.ref))return;
        const kinds=[];if(row[6].includes(node.ref))kinds.push('declared');if(row[7].includes(node.ref))kinds.push('changed');if(row[8]&&row[8].includes(node.ref))kinds.push('outside scope');
        const button=text('button',cut(title(row),100)+' · '+kinds.join(', '));
        button.addEventListener('click',()=>{
          $('search').value=row[0];$('outcome').value='all';$('neighbors').checked=false;render();inspect('s'+i);
        });
      });
    }
  }
  function position() {
    nodes.forEach(n=>n.el.setAttribute('transform','translate('+n.x+','+n.y+')'));
    edges.forEach(e=>{e.el.setAttribute('x1',e.a.x);e.el.setAttribute('y1',e.a.y);e.el.setAttribute('x2',e.b.x);e.el.setAttribute('y2',e.b.y);});
  }
  function layout() {
    const count=Math.max(1,nodes.length);
    nodes.forEach((n,i)=>{const angle=i*2.39996322973,r=30+22*Math.sqrt(i);n.x=Math.cos(angle)*r+(n.type==='session'?-100:100);n.y=Math.sin(angle)*r;});
    for(let step=0;step<100;step++) {
      nodes.forEach(n=>{n.dx=-n.x*.002;n.dy=-n.y*.002;});
      for(let i=0;i<count;i++)for(let j=i+1;j<count;j++) {
        const a=nodes[i],b=nodes[j];if(!a||!b)continue;
        const dx=a.x-b.x,dy=a.y-b.y,dist2=Math.max(25,dx*dx+dy*dy);
        const f=Math.min(2,1800/dist2),dist=Math.sqrt(dist2);
        a.dx+=dx/dist*f;a.dy+=dy/dist*f;b.dx-=dx/dist*f;b.dy-=dy/dist*f;
      }
      edges.forEach(e=>{const dx=e.b.x-e.a.x,dy=e.b.y-e.a.y,d=Math.max(1,Math.hypot(dx,dy)),f=(d-105)*.009;e.a.dx+=dx/d*f;e.a.dy+=dy/d*f;e.b.dx-=dx/d*f;e.b.dy-=dy/d*f;});
      nodes.forEach(n=>{n.x+=Math.max(-8,Math.min(8,n.dx));n.y+=Math.max(-8,Math.min(8,n.dy));});
    }
  }
  function render() {
    const query=$('search').value.trim().toLowerCase(),outcome=$('outcome').value;
    const matching=data.sessions.map((row,i)=>({row,i})).filter(({row})=>(outcome==='all'||row[5]===outcome)&&
      [title(row),row[0],...pathIds(row).map(i=>data.paths[i])].some(value=>value.toLowerCase().includes(query)));
    const shown=matching.slice(0,150);
    const enabled=new Set([...document.querySelectorAll('[data-edge]:checked')].map(el=>el.dataset.edge));
    const pathSet=new Set();
    shown.forEach(({row})=>{if(enabled.has('declared'))row[6].forEach(p=>pathSet.add(p));if(enabled.has('changed'))row[7].filter(p=>!row[8]||!row[8].includes(p)).forEach(p=>pathSet.add(p));if(enabled.has('outside'))(row[8]||[]).forEach(p=>pathSet.add(p));});
    const pathRefs=[...pathSet].sort((a,b)=>Number(data.paths[b].toLowerCase().includes(query))-Number(data.paths[a].toLowerCase().includes(query))||a-b).slice(0,350-shown.length);
    nodes=[...shown.map(({row,i})=>({id:'s'+i,type:'session',ref:i,label:title(row)})),...pathRefs.map(i=>({id:'p'+i,type:'path',ref:i,label:data.paths[i]}))];
    svg.classList.toggle('dense',nodes.length>75);
    const byId=new Map(nodes.map(n=>[n.id,n])); edges=[];
    const add=(session,path,kind)=>{if(enabled.has(kind)&&byId.has('p'+path))edges.push({a:byId.get('s'+session),b:byId.get('p'+path),kind});};
    shown.forEach(({row,i})=>{row[6].forEach(p=>add(i,p,'declared'));row[7].forEach(p=>add(i,p,row[8]&&row[8].includes(p)?'outside':'changed'));});
    edgeLayer.replaceChildren();vertexLayer.replaceChildren();$('nodes').replaceChildren();
    edges.forEach(e=>{e.el=make('line',{class:'edge '+e.kind});edgeLayer.append(e.el);});
    nodes.forEach(n=>{
      const group=make('g',{class:'node',role:'button',tabindex:0,'aria-label':n.type+': '+n.label});
      group.dataset.id=n.id;
      group.append(n.type==='session'?make('circle',{r:8}):make('rect',{x:-5,y:-5,width:10,height:10,rx:2}));
      group.append(make('title',{},n.label));
      group.append(make('text',{x:13,y:4},cut(n.label.split('/').at(-1)||n.label,27)));
      group.addEventListener('click',()=>{if(!moved)inspect(n.id);});
      group.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();inspect(n.id);}});
      n.el=group;vertexLayer.append(group);
      const button=document.createElement('button');button.className='node-button';button.setAttribute('aria-pressed','false');
      const kind=document.createElement('span');kind.className='kind';kind.textContent=n.type==='session'?data.sessions[n.ref][5].toUpperCase():'PATH';button.append(kind,document.createTextNode(cut(n.label,100)));
      button.addEventListener('click',()=>inspect(n.id));n.button=button;$('nodes').append(button);
    });
    const hidden=matching.length-shown.length+pathSet.size-pathRefs.length;
    const counts=matching.reduce((out,{row})=>{out[row[5]]=(out[row[5]]||0)+1;return out;},{});
    $('coverage').textContent=matching.length+' matching sessions · '+(counts.merged||0)+' landed · '+(counts.open||0)+' open · '+(counts.abandoned||0)+' abandoned · '+(counts.empty||0)+' empty. '+
      (hidden?hidden+' graph nodes hidden for readability; narrow your search. ':'')+
      'Export includes all '+data.sessions.length+' sessions in this snapshot.'+(data.snapshot.omitted?' '+data.snapshot.omitted+' older matching sessions omitted by CLI --limit.':'')+
      (data.snapshot.path?' Path filter: '+data.snapshot.path+'.':'')+(data.snapshot.session?' Session filter: '+data.snapshot.session+'.':'');
    $('count').textContent=nodes.length;
    $('empty').hidden=nodes.length>0;
    $('empty').textContent=data.sessions.length?'No matches. Clear the search or change the outcome filter.':'No sessions in this snapshot. Record work with session start, or widen --days.';
    if(selected&&!byId.has(selected))selected=null;
    layout();position();fit();inspect(selected);
  }
  let timer;
  $('search').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(render,100);});
  $('outcome').addEventListener('change',render);
  document.querySelectorAll('[data-edge]').forEach(el=>el.addEventListener('change',render));
  $('neighbors').addEventListener('change',highlight);
  $('fit').addEventListener('click',fit);
  $('clear').addEventListener('click',()=>{$('neighbors').checked=false;inspect(null);});
  $('zoom-in').addEventListener('click',()=>zoom(.8));$('zoom-out').addEventListener('click',()=>zoom(1.25));
  svg.addEventListener('wheel',event=>{event.preventDefault();zoom(event.deltaY>0?1.12:.89,point(event));},{passive:false});
  svg.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    const el=event.target.closest('.node'), node=el?nodes.find(n=>n.id===el.dataset.id):null;
    drag={node,point:point(event),box:{...box},x:event.clientX,y:event.clientY};moved=false;svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove',event=>{
    if(!drag)return;
    if(Math.hypot(event.clientX-drag.x,event.clientY-drag.y)>3)moved=true;
    if(drag.node){const p=point(event);drag.node.x=p.x;drag.node.y=p.y;position();}
    else {const p=point(event);box.x+=drag.point.x-p.x;box.y+=drag.point.y-p.y;view();}
  });
  svg.addEventListener('pointerup',event=>{if(drag&&!moved&&drag.node)inspect(drag.node.id);drag=null;if(svg.hasPointerCapture(event.pointerId))svg.releasePointerCapture(event.pointerId);});
  svg.addEventListener('pointercancel',()=>{drag=null;});
  svg.addEventListener('keydown',event=>{if(event.target!==svg)return;if(event.key==='+')zoom(.8);if(event.key==='-')zoom(1.25);if(event.key==='0')fit();});
  $('export').addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify(data)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='session-knowledge.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  window.addEventListener('resize',fit);
  render();
})();
`;
