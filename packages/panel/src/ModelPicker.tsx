import React, {useState} from 'react';
import {Bot, Check, ChevronDown} from 'lucide-react';
import {Popover, PopoverTrigger, PopoverContent} from './components/ui/popover';

const items = (option:any):any[] => (option?.options || []).flatMap((x:any) => x.options || [x]);
const display = (option:any) => items(option).find(x => x.value === option?.currentValue)?.name || option?.currentValue;

// The docked model list and separate effort column follow T3 Code's
// ProviderModelPicker and ModelPickerContent. See THIRD_PARTY_NOTICES.
export function ModelPicker({agents, selected, data, onOpen, onAgent, onChange, label}:any) {
 const [open,setOpen]=useState(false), [query,setQuery]=useState('');
 const options=data[selected]?.configOptions || [];
 const model=options.find((x:any)=>x.type==='select'&&x.category==='model');
 const effort=options.find((x:any)=>x.type==='select'&&x.category==='thought_level');
 const others=options.filter((x:any)=>x.type==='select'&&x.category!=='model'&&x.category!=='thought_level');
 const currentAgent=agents.find((x:any)=>x.id===selected);
 return <Popover open={open} onOpenChange={(value:boolean)=>{setOpen(value);if(value)onOpen()}}>
  <PopoverTrigger className="model-trigger" aria-label={label('Choose model','モデルを選択')} title={label('Choose model','モデルを選択')}><Bot size={15}/><span className="model-name">{display(model)||currentAgent?.label||label('Choose model','モデルを選択')}</span>{display(effort)&&<span className="model-effort">{display(effort)}</span>}<ChevronDown size={12}/></PopoverTrigger>
  <PopoverContent side="top" align="end" className="model-popup" aria-label={label('Models and settings','モデルと設定')}>
   <div className="model-list"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={label('Search models','モデルを検索')} aria-label={label('Search models','モデルを検索')}/>
    {agents.map((agent:any)=>{const option=data[agent.id]?.configOptions?.find((x:any)=>x.type==='select'&&x.category==='model');const matches=items(option).filter(x=>`${x.name||x.value} ${agent.label||agent.id}`.toLowerCase().includes(query.toLowerCase()));return <div key={agent.id}><div className="model-group">{agent.label||agent.id}{agent.available===false&&<small> {agent.reason||label('Unavailable','利用不可')}</small>}</div>{!option&&<button disabled={agent.available===false} onClick={()=>onAgent(agent.id)}>{label('Select agent','エージェントを選択')}{agent.id!==selected&&<small>{label('New chat','新しいチャット')}</small>}</button>}{matches.slice(0,100).map((x:any)=><button key={x.value} disabled={agent.available===false} title={x.description} onClick={()=>{onAgent(agent.id);onChange(agent.id,option.id,x.value)}}><span>{x.name||x.value}</span>{agent.id!==selected&&<small>{label('New chat','新しいチャット')}</small>}{agent.id===selected&&option.currentValue===x.value&&<Check size={14}/>}</button>)}{matches.length>100&&<small className="model-more">{label('Search to narrow results','検索して絞り込む')}</small>}</div>})}
   </div><div className="model-settings">{effort&&<><div className="model-group">{effort.name||label('Effort','推論レベル')}</div>{items(effort).map((x:any)=><button key={x.value} title={x.description} onClick={()=>onChange(selected,effort.id,x.value)}>{x.name||x.value}{effort.currentValue===x.value&&<Check size={14}/>}</button>)}</>}{others.map((o:any)=><label key={o.id}>{o.name}<select value={o.currentValue} onChange={e=>onChange(selected,o.id,e.target.value)}>{items(o).map((x:any)=><option key={x.value} value={x.value}>{x.name||x.value}</option>)}</select></label>)}</div>
  </PopoverContent>
 </Popover>;
}
