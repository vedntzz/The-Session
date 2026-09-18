// DOM-level interaction tests for the embedded script, without opening a browser.
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildKnowledge } from '../src/knowledge.js';
import { KNOWLEDGE_CLIENT } from '../src/render/knowledge/client.js';
import { zeroCost, type Session } from '../src/store.js';

class Element {
  children: Element[]=[]; attrs: Record<string,string>={}; dataset: Record<string,string>={}; style: Record<string,string>={};
  handlers: Record<string,((event:any)=>void)[]>={}; value=''; checked=true; hidden=false; own=''; className='';
  clientWidth=800;clientHeight=600;parent?:Element;capture=false;download='';href='';
  classes=new Set<string>();classList={toggle:(value:string,on:boolean)=>on?this.classes.add(value):this.classes.delete(value)};
  constructor(public tag='div'){}
  set textContent(value:string){this.own=String(value);this.children=[];}
  get textContent():string{return this.own+this.children.map(c=>c.textContent).join('');}
  setAttribute(key:string,value:string){this.attrs[key]=String(value);}
  append(...children:Element[]){children.forEach(c=>{c.parent=this;this.children.push(c);});}
  replaceChildren(...children:Element[]){this.own='';this.children=[];this.append(...children);}
  addEventListener(type:string,callback:(event:any)=>void){(this.handlers[type]??=[]).push(callback);}
  emit(type:string,event:any={}){(this.handlers[type]??[]).forEach(fn=>fn({target:this,preventDefault(){},...event}));}
  click(){this.emit('click');}
  closest(selector:string):Element|null{return selector==='.node'&&this.attrs.class==='node'?this:this.parent?.closest(selector)??null;}
  setPointerCapture(){this.capture=true;}hasPointerCapture(){return this.capture;}releasePointerCapture(){this.capture=false;}
  getScreenCTM(){return{inverse(){return {};}};}
  createSVGPoint(){return{x:0,y:0,matrixTransform(){return{x:this.x,y:this.y};}};}
}
function setup(count=2,empty=false){
  const sessions:Session[]=Array.from({length:count},(_,i)=>({id:'session-'+i,repo:'path:/repo',intent:i===0?'<img onerror=alert(1)> fix orders':'write docs '+i,intentSource:'declared',scope:['src'],baseline:[],reality:['src/orders.ts'],drift:i===0?['src/orders.ts']:[],outcome:i===0?'merged':'open',cost:zeroCost(),startCommit:'abc',startedAt:'2026-09-17T12:00:00Z',endedAt:'2026-09-17T13:00:00Z'}));
  if(empty)sessions.forEach(s=>{s.scope=[];s.reality=[];s.drift=[];s.outcome='empty';});
  const data=buildKnowledge(sessions,'path:/repo',{at:'2026-09-18T00:00:00Z',days:30,matching:count});
  const ids=['data','graph','edges','vertices','neighbors','inspector','nodes','search','outcome','coverage','count','empty','fit','clear','zoom-in','zoom-out','export'];
  const els=Object.fromEntries(ids.map(id=>[id,new Element()]));els.data!.textContent=JSON.stringify(data);els.outcome!.value='all';els.neighbors!.checked=false;
  const checks=['declared','changed','outside'].map(kind=>{const el=new Element('input');el.dataset.edge=kind;return el;});
  let exported:Blob|undefined;
  const document={getElementById:(id:string)=>els[id],createElement:(tag:string)=>new Element(tag),createElementNS:(_ns:string,tag:string)=>new Element(tag),createTextNode:(text:string)=>{const el=new Element('text');el.textContent=text;return el;},querySelectorAll:(query:string)=>query.endsWith(':checked')?checks.filter(c=>c.checked):checks};
  runInNewContext(KNOWLEDGE_CLIENT,{document,window:{addEventListener(){}},Blob,URL:{createObjectURL(blob:Blob){exported=blob;return'blob:test';},revokeObjectURL(){}},setTimeout:(fn:()=>void)=>{fn();return 1;},clearTimeout(){} });
  return {els,checks,data,exported:()=>exported};
}
describe('knowledge graph interactions',()=>{
  it('lays out session and path nodes with recorded relation kinds and safe text',()=>{
    const {els}=setup();
    expect(els.vertices!.children).toHaveLength(4);
    expect(els.edges!.children.map(e=>e.attrs.class)).toContain('edge outside');
    expect(els.vertices!.children.every(n=>!n.attrs.transform!.includes('NaN'))).toBe(true);
    els.nodes!.children[0]!.click();
    expect(els.inspector!.textContent).toContain('<img onerror=alert(1)> fix orders');
    expect(els.inspector!.children.some(el=>el.tag==='img')).toBe(false);
    expect(els.inspector!.textContent).toContain('Start commit abc');
    expect(els.vertices!.children[0]!.attrs['aria-pressed']).toBe('true');
  });
  it('searches, filters outcomes and relationships, and recovers from no matches',()=>{
    const {els,checks}=setup();
    els.search!.value='docs';els.search!.emit('input');
    expect(els.coverage!.textContent).toContain('1 matching sessions');
    els.outcome!.value='merged';els.outcome!.emit('change');
    expect(els.empty!.hidden).toBe(false);
    els.search!.value='';els.search!.emit('input');
    expect(els.empty!.hidden).toBe(true);
    checks[2]!.checked=false;checks[2]!.emit('change');
    expect(els.edges!.children.some(e=>e.attrs.class==='edge outside')).toBe(false);
  });
  it('supports neighborhood selection, zoom, reset and JSON download',async()=>{
    const {els,data,exported}=setup();
    els.nodes!.children[0]!.click();els.neighbors!.checked=true;els.neighbors!.emit('change');
    expect(els.vertices!.children[1]!.style.display).toBe('none');
    els.clear!.click();expect(els.vertices!.children[1]!.style.display).toBe('');
    const before=els.graph!.attrs.viewBox;els['zoom-in']!.click();expect(els.graph!.attrs.viewBox).not.toBe(before);
    els.fit!.click();expect(els.graph!.attrs.viewBox).toBe(before);
    els.export!.click();expect(JSON.parse(await exported()!.text())).toEqual(data);
  });
  it('caps only the displayed graph, reports that cap, and preserves the full export',async()=>{
    const {els,exported}=setup(200);
    expect(els.vertices!.children.length).toBeLessThanOrEqual(350);
    expect(els.coverage!.textContent).toContain('graph nodes hidden');
    els.export!.click();expect(JSON.parse(await exported()!.text()).sessions).toHaveLength(200);
  });
  it('preserves isolated empty sessions as selectable graph nodes',()=>{
    const isolated=setup(2,true);
    expect(isolated.els.vertices!.children).toHaveLength(2);
    expect(isolated.els.edges!.children).toHaveLength(0);
    isolated.els.nodes!.children[0]!.click();
    expect(isolated.els.inspector!.textContent).toContain('empty · declared');
    const {els}=setup(0);
    expect(els.empty!.textContent).toContain('No sessions in this snapshot');
    expect(els.vertices!.children).toHaveLength(0);
  });
  it('moves nodes and connected edges, and pans the background',()=>{
    const {els}=setup();
    const graph=els.graph!,node=els.vertices!.children[0]!;
    const before=node.attrs.transform;
    graph.emit('pointerdown',{target:node.children[0],button:0,clientX:10,clientY:20,pointerId:1});
    graph.emit('pointermove',{clientX:60,clientY:80});
    graph.emit('pointerup',{pointerId:1});
    expect(node.attrs.transform).not.toBe(before);
    expect(els.edges!.children[0]!.attrs.x1).toBe('60');
    const view=graph.attrs.viewBox;
    graph.emit('pointerdown',{button:0,clientX:10,clientY:20,pointerId:2});
    graph.emit('pointermove',{clientX:50,clientY:70});
    graph.emit('pointerup',{pointerId:2});
    expect(graph.attrs.viewBox).not.toBe(view);
  });
});
