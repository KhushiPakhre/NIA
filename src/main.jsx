import React,{useEffect,useState,useRef,useCallback} from 'react';
import {createRoot} from 'react-dom/client';
import {LayoutDashboard,Users,CalendarDays,Building2,Workflow,BarChart3,PhoneCall,MessageSquare,Settings,Plus,RefreshCw,Search,ChevronRight,CheckCircle2,Clock3,AlertTriangle,ArrowRight,ShieldCheck,Menu,X,Send,Mail,StickyNote, Sparkles, Target, MapPin, IndianRupee, UserRound, Zap, Upload, Play, Pause, Activity, Radio, Mic, MicOff, PhoneOff, Volume2, Gauge} from 'lucide-react';
import {api,openStream} from './api.js';
import * as XLSX from 'xlsx';
import './app.css';

const NAV=[['leads','Lead Inbox',Users],['conversations','Conversations',MessageSquare],['voice','Live Call',PhoneCall],['live','Live Feed',Activity],['dashboard','Dashboard',LayoutDashboard],['demand','Demand Gap',Target],['inventory','Inventory',Building2],['team','Team',UserRound],['automation','Automation',Workflow]];
const MARKETS=[['DXB','Dubai'],['SIN','Singapore'],['LON','London'],['NYC','New York'],['BLR','Bengaluru'],['TYO','Tokyo'],['BER','Berlin'],['SYD','Sydney']];
const LOCALES=[{id:'en',label:'EN'},{id:'hi',label:'हिं'},{id:'ar',label:'عر'},{id:'es',label:'ES'}];
const CURRENCIES={INR:{symbol:'₹',locale:'en-IN',rate:1},USD:{symbol:'$',locale:'en-US',rate:0.012},EUR:{symbol:'€',locale:'de-DE',rate:0.011},AED:{symbol:'د.إ',locale:'ar-AE',rate:0.044}};
const stageTone={CAPTURED:'gray',QUALIFYING:'blue',MATCHED:'blue',SHORTLIST:'green',NURTURING:'amber',WARM:'green',CLOSED:'gray'};
function money(n,currency='INR'){if(n==null)return '—';const c=CURRENCIES[currency]||CURRENCIES.INR;return `${c.symbol}${Math.round(Number(n)*c.rate).toLocaleString(c.locale)}`}
function Badge({children,tone='gray'}){return <span className={`badge ${tone}`}>{children}</span>}
function Metric({label,value,sub,icon:Icon}){return <div className="metric"><div><div className="metric-label">{label}</div><div className="metric-value">{value}</div>{sub&&<div className="metric-sub">{sub}</div>}</div>{Icon&&<div className="metric-icon"><Icon size={18}/></div>}</div>}
function Empty({title,text}){return <div className="empty"><div className="empty-icon"><Workflow size={20}/></div><strong>{title}</strong><span>{text}</span></div>}
function Modal({title,onClose,children}){return <div className="modal-back"><div className="modal"><div className="modal-head"><strong>{title}</strong><button className="icon-btn" onClick={onClose}><X size={18}/></button></div>{children}</div></div>}
function Stories({active,onPick}){return <div className="stories-row" aria-label="Global markets">{MARKETS.map(([code,name])=><button type="button" className="story" key={code} onClick={()=>onPick?.(code)}><div className={"story-avatar"+(active===code?" active":"")}>{code.slice(0,2)}</div><span>{name}</span></button>)}</div>}

// ---------------------------------------------------------------------------
// P3 — live stream plumbing
// ---------------------------------------------------------------------------
// One EventSource for the whole app, opened once at the root and shared through
// context. Opening a stream per screen would mean N connections per tab and N
// replay buffers to reconcile; this way every screen reads the same ordered frames.
const FEED_LIMIT=400;
function useLiveStream({leadId=null,onFrame}={}){
 const [status,setStatus]=useState('connecting');
 const [frames,setFrames]=useState([]);
 const handler=useRef(onFrame);
 useEffect(()=>{handler.current=onFrame});
 useEffect(()=>{
   setStatus('connecting');
   const close=openStream({leadId,onStatus:setStatus,onFrame:f=>{
     if(f.kind!=='ready')setFrames(prev=>[f,...prev].slice(0,FEED_LIMIT));
     handler.current?.(f);
   }});
   return close;
 },[leadId]);
 return {status,frames,clear:()=>setFrames([])};
}
function LiveDot({status}){
 const label=status==='live'?'Live':status==='reconnecting'?'Reconnecting':status==='connecting'?'Connecting':'Offline';
 return <span className={`live-pill ${status}`} title={`Activity stream: ${label.toLowerCase()}`}><Radio size={12}/>{label}</span>;
}
const FRAME_LIMIT_NOTE='Showing the most recent activity. Older history stays in the lead timeline.';
function frameTitle(f){
 if(f.kind==='activity')return f.activity?.title||'Activity';
 if(f.kind==='event')return String(f.event?.event_type||'EVENT').replaceAll('_',' ').toLowerCase();
 if(f.kind==='lead')return `${f.lead?.stage||'Lead'} · score ${f.lead?.score??'—'}`;
 return f.kind;
}
function frameBody(f){
 if(f.kind==='activity')return f.activity?.body||'';
 if(f.kind==='event'){
   const p=f.event?.payload||{};
   if(p.reason)return p.reason;
   if(p.action)return `${p.action}${p.latency_ms!=null?` · ${p.latency_ms}ms`:''}`;
   if(p.score!=null)return `score ${p.score}`;
   if(p.text)return p.text;
   if(p.count!=null)return `${p.count} item${p.count===1?'':'s'}`;
   const keys=Object.keys(p);
   return keys.length?keys.slice(0,3).map(k=>`${k.replaceAll('_',' ')}: ${JSON.stringify(p[k])}`).join(' · '):'';
 }
 if(f.kind==='lead')return f.lead?.next_action?String(f.lead.next_action).replaceAll('_',' ').toLowerCase():'';
 return '';
}
const FRAME_TONE={activity:'blue',event:'gray',lead:'green'};

function App(){
 const [tab,setTab]=useState('leads'),[role,setRole]=useState('Sales Rep'),[mobile,setMobile]=useState(false),[health,setHealth]=useState(null),[tenant,setTenant]=useState(null),[leads,setLeads]=useState([]),[demand,setDemand]=useState([]),[automation,setAutomation]=useState({}),[inventory,setInventory]=useState([]),[bookings,setBookings]=useState([]),[tours,setTours]=useState([]),[handoffs,setHandoffs]=useState([]),[analytics,setAnalytics]=useState({}),[cadence,setCadence]=useState([]),[team,setTeam]=useState([]),[selected,setSelected]=useState(null),[toast,setToast]=useState(''),[locale,setLocale]=useState('en'),[currency,setCurrency]=useState('INR'),[market,setMarket]=useState('BLR');
 const refresh=async()=>{
   const jobs=await Promise.allSettled([api.health(),api.tenant(),api.leads(),api.inventory(),api.bookings(),api.tours(),api.handoffs(),api.analytics(),api.cadence(),api.demandGap(),api.automation(),api.team()]);
   const [h,t,l,i,b,tr,ho,a,c,d,aut,tm]=jobs;
   if(h.status==='fulfilled')setHealth(h.value);
   if(t.status==='fulfilled')setTenant(t.value);
   if(l.status==='fulfilled')setLeads(l.value);
   if(i.status==='fulfilled')setInventory(i.value);
   if(b.status==='fulfilled')setBookings(b.value);
   if(tr.status==='fulfilled')setTours(tr.value);
   if(ho.status==='fulfilled')setHandoffs(ho.value);
   if(a.status==='fulfilled')setAnalytics(a.value);
   if(c.status==='fulfilled')setCadence(c.value);
   if(d.status==='fulfilled')setDemand(d.value);
   if(aut.status==='fulfilled')setAutomation(aut.value);
   if(tm.status==='fulfilled')setTeam(tm.value);
   const failed=jobs.find(x=>x.status==='rejected');
   if(failed) setToast(failed.reason?.message||'Some dashboard data could not be refreshed');
 };
 useEffect(()=>{refresh()},[]); useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(''),3200);return()=>clearTimeout(t)}},[toast]);
 // A pushed frame tells us *that* something changed; the collections are still
 // fetched normally so the screen stays consistent with the database rather than
 // being patched up from event payloads. Debounced because one automation pass
 // emits several frames in a row and each one does not deserve its own refetch.
 const liveTimer=useRef(null);
 const live=useLiveStream({onFrame:f=>{if(f.kind==='ready')return;clearTimeout(liveTimer.current);liveTimer.current=setTimeout(()=>{refresh()},700)}});
 useEffect(()=>()=>clearTimeout(liveTimer.current),[]);
 const fmt=(n)=>money(n,currency);
 const ctx={leads,setLeads,inventory,bookings,tours,handoffs,analytics,cadence,demand,automation,team,selected,setSelected,refresh,setToast,currency,fmt,locale,market,health,tenant,live};
 return <div className="app"><aside className={mobile?'open':''}><div className="brand"><div className="logo">D</div><div><b>Deskline</b><small>Global AI sales OS</small></div><button className="mobile-close icon-btn" onClick={()=>setMobile(false)}><X size={18}/></button></div><div className="tenant"><div className="avatar">VW</div><div><b>{tenant?.name||'Vantage Workspaces'}</b><small>{MARKETS.find(m=>m[0]===market)?.[1]||'Bengaluru'} · Demo tenant</small></div></div><div className="intl-bar"><div className="locale-switch" aria-label="Language">{LOCALES.map(l=><button key={l.id} type="button" className={locale===l.id?'active':''} onClick={()=>setLocale(l.id)}>{l.label}</button>)}</div></div><nav>{NAV.map(([id,label,Icon])=><button key={id} className={tab===id?'nav-active':''} onClick={()=>{setTab(id);setMobile(false)}}><Icon size={17}/><span>{label}</span>{id==='leads'&&handoffs.filter(x=>x.status==='OPEN').length>0&&<em>{handoffs.filter(x=>x.status==='OPEN').length}</em>}</button>)}</nav><div className="side-quick"><button className="side-link" onClick={()=>{setTab('settings');setMobile(false)}}><Settings size={16}/><span>Settings</span></button><div className="side-caption">Markets worldwide · switch locale & currency anytime.</div></div><div className="side-bottom"><div className="health"><span className={health?.ok?'dot on':'dot'}></span> API {health?.ok?'connected':'offline'}</div><div className="health"><span className={live.status==='live'?'dot on':'dot'}></span> Stream {live.status}</div><div className="role"><span>View as</span><select value={role} onChange={e=>setRole(e.target.value)}><option>Sales Rep</option><option>Manager</option><option>Admin</option></select></div></div></aside><main><header><button className="menu icon-btn" onClick={()=>setMobile(true)}><Menu size={20}/></button><div><div className="eyebrow">{role} · {locale.toUpperCase()} · global</div><h1>{NAV.find(x=>x[0]===tab)?.[1]}</h1></div><div className="head-actions"><LiveDot status={live.status}/><div className="currency-pill" title="Display currency">{Object.keys(CURRENCIES).map(c=><button key={c} type="button" className={currency===c?'active':''} onClick={()=>setCurrency(c)}>{c}</button>)}</div><button className="btn ghost" onClick={refresh}><RefreshCw size={15}/> Refresh</button><button className="btn primary" onClick={()=>setTab('leads')}><Plus size={15}/> New lead</button></div></header><div className="content"><Stories active={market} onPick={setMarket}/>{tab==='leads'&&<Leads {...ctx}/>} {tab==='conversations'&&<Conversations {...ctx}/>} {tab==='dashboard'&&<Dashboard {...ctx} setTab={setTab}/>} {tab==='today'&&<Today {...ctx}/>} {tab==='inventory'&&<Inventory {...ctx}/>} {tab==='team'&&<Team {...ctx}/>} {tab==='bookings'&&<Bookings {...ctx}/>} {tab==='tours'&&<Tours {...ctx}/>} {tab==='handoffs'&&<Handoffs {...ctx}/>} {tab==='automation'&&<Automation {...ctx}/>} {tab==='analytics'&&<Analytics {...ctx}/>} {tab==='demand'&&<DemandGap {...ctx}/>} {tab==='voice'&&<LiveCall {...ctx}/>} {tab==='live'&&<LiveFeed {...ctx} setTab={setTab}/>} {tab==='settings'&&<SettingsPage {...ctx}/>}</div></main>{toast&&<div className="toast"><CheckCircle2 size={16}/>{toast}</div>}</div>
}

function LeadTable({leads,onSelect,onToggleVoice}){return <div className="table-wrap"><table><thead><tr><th>Lead</th><th>Channel</th><th>Stage</th><th>Fit</th><th>Voice</th><th>SLA / updated</th></tr></thead><tbody>{leads.map(l=><tr key={l.id} onClick={()=>onSelect?.(l)}><td><div className="lead-cell"><div className="lead-avatar">{(l.company||'?').slice(0,2).toUpperCase()}</div><div><b>{l.company}</b><small>{l.contact||'—'}</small></div></div></td><td><Badge tone="gray">{l.channel||l.source||'web'}</Badge></td><td><Badge tone={stageTone[l.stage]||'gray'}>{l.stage}</Badge></td><td><div className="fit-score"><b>{l.score??'—'}</b>{l.score!=null&&<span><i style={{width:`${l.score}%`}}/></span>}</div></td><td><button type="button" className={`voice-mini ${l.voice_enabled!==false?'on':''}`} aria-label={l.voice_enabled!==false?'Turn voice off':'Turn voice on'} title={l.voice_enabled!==false?'Voice enabled — click to turn off':'Voice disabled — click to turn on'} onClick={e=>{e.preventDefault();e.stopPropagation();onToggleVoice?.(l)}}><PhoneCall size={12}/></button></td><td>{l.stage==='WARM'?<Badge tone="amber">SLA active</Badge>:new Date(l.updated_at||l.created_at).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</td></tr>)}</tbody></table>{!leads.length&&<Empty title="No leads yet" text="Create a lead to start the qualification flow."/>}</div>}

function Leads({leads,inventory,selected,setSelected,refresh,setToast,setLeads,fmt}){const [q,setQ]=useState(''),[stage,setStage]=useState('ALL'),[newOpen,setNewOpen]=useState(false),[matches,setMatches]=useState(null);const toggleVoice=async l=>{const next=l.voice_enabled===false;setLeads?.(prev=>prev.map(x=>x.id===l.id?{...x,voice_enabled:next}:x));try{await api.updateLead(l.id,{voice_enabled:next});setToast(next?'Voice enabled':'Voice disabled')}catch(e){setLeads?.(prev=>prev.map(x=>x.id===l.id?{...x,voice_enabled:l.voice_enabled}:x));setToast(e.message)}};const rows=leads.filter(l=>(stage==='ALL'||l.stage===stage)&&`${l.company} ${l.contact} ${l.channel}`.toLowerCase().includes(q.toLowerCase()));const open=async l=>{setSelected(l);setMatches({lead:l,requirement:{},matches:[]});try{setMatches(await api.matches(l.id))}catch(e){setToast(e.message)}};useEffect(()=>{if(selected&&!matches)open(selected)},[selected?.id]);return <><div className="inbox-hero"><div><div className="eyebrow">Sales command center · worldwide</div><h2>Every lead, one colorful workspace.</h2><p>Qualify, match, shortlist, follow up and hand off — built for global teams.</p></div><div className="hero-stats"><span><b>{leads.length}</b> total</span><span><b>{leads.filter(x=>x.stage==='WARM').length}</b> warm</span><span><b>{leads.filter(x=>x.stage==='MATCHED'||x.stage==='SHORTLIST').length}</b> matched</span></div></div><div className="toolbar"><div className="search"><Search size={16}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search company, contact or source"/></div><select value={stage} onChange={e=>setStage(e.target.value)}><option>ALL</option>{['CAPTURED','QUALIFYING','MATCHED','SHORTLIST','NURTURING','WARM'].map(x=><option key={x}>{x}</option>)}</select><button className="btn primary" onClick={()=>setNewOpen(true)}><Plus size={15}/> Create lead</button></div><section className="card"><div className="card-head"><div><h2>Lead inbox</h2><p>{rows.length} visible · click any lead for the working panel</p></div><Badge tone="green"><ShieldCheck size={12}/> Grounded inventory</Badge></div><LeadTable leads={rows} onSelect={open} onToggleVoice={toggleVoice}/></section><SeedDemo refresh={refresh} setToast={setToast} fmt={fmt}/>{selected&&matches&&<LeadDrawer lead={selected} data={matches} onClose={()=>{setSelected(null);setMatches(null)}} refresh={refresh} setToast={setToast} fmt={fmt}/>} {newOpen&&<LeadModal onClose={()=>setNewOpen(false)} refresh={refresh} setToast={setToast}/>}</>}

function SeedDemo({refresh,setToast,fmt=money}){
 const [open,setOpen]=useState(false),[step,setStep]=useState(1),[f,setF]=useState({company:'',contact:'',channel:'whatsapp',product_type:'private_office',seats:8,market:'Golf Course Road',budget:15000,move_in_date:'Immediate',tenure:'12 months',notes:''}),[busy,setBusy]=useState(false);
 const set=(k,v)=>setF(x=>({...x,[k]:v}));
 const submit=async e=>{e.preventDefault();setBusy(true);try{const r=await api.seedDemo(f);await refresh();setToast(`Lead ${r.lead.company} entered CRM and automation ran`);setOpen(false);setStep(1);setF({...f,company:'',contact:'',notes:''})}catch(e){setToast(e.message)}finally{setBusy(false)}};
 return <section className="seed-demo card"><div className="seed-head"><div><div className="eyebrow">Demo playground</div><h2>Try your own lead</h2><p>Enter a realistic lead and watch Deskline do the work automatically. No technical setup required.</p></div><button className="btn primary" onClick={()=>setOpen(!open)}><Plus size={15}/> {open?'Close':'Add a lead'}</button></div>
  <div className="seed-explain"><div className="seed-step active"><span>1</span><div><b>Enter lead</b><small>Simple customer details</small></div></div><ArrowRight size={14}/><div className="seed-step"><span>2</span><div><b>AI qualifies</b><small>Requirements are captured</small></div></div><ArrowRight size={14}/><div className="seed-step"><span>3</span><div><b>Find & send</b><small>Best inventory is shortlisted</small></div></div><ArrowRight size={14}/><div className="seed-step"><span>4</span><div><b>Warm & handoff</b><small>Human takes over at the right time</small></div></div></div>
  {open&&<form className="seed-form seed-form-pro" onSubmit={submit}><div className="seed-progress"><button type="button" className={step===1?'active':''} onClick={()=>setStep(1)}>1 Lead</button><button type="button" className={step===2?'active':''} onClick={()=>setStep(2)}>2 Requirement</button><button type="button" className={step===3?'active':''} onClick={()=>setStep(3)}>3 Review</button></div>
   {step===1&&<div className="form-grid"><label>Company / customer<input required value={f.company} onChange={e=>set('company',e.target.value)} placeholder="Acme Labs"/></label><label>Contact name<input value={f.contact} onChange={e=>set('contact',e.target.value)} placeholder="Rhea Kapoor"/></label><label>Lead source<select value={f.channel} onChange={e=>set('channel',e.target.value)}><option value="whatsapp">WhatsApp</option><option value="web">Website</option><option value="portal">Portal</option><option value="call">Phone call</option><option value="meta">Meta</option></select></label><label>What are they looking for?<select value={f.product_type} onChange={e=>set('product_type',e.target.value)}><option value="private_office">Private office</option><option value="meeting_room">Meeting room</option><option value="dedicated_desk">Dedicated desk</option><option value="cabin">Cabin</option></select></label><div className="seed-actions"><button type="button" className="btn primary" onClick={()=>setStep(2)}>Continue <ArrowRight size={15}/></button></div></div>}
   {step===2&&<div className="form-grid"><label>Seats<input type="number" min="1" value={f.seats} onChange={e=>set('seats',e.target.value)}/></label><label>Location / market<input value={f.market} onChange={e=>set('market',e.target.value)} placeholder="Golf Course Road"/></label><label>Monthly budget<input type="number" value={f.budget} onChange={e=>set('budget',e.target.value)}/></label><label>Move-in<input value={f.move_in_date} onChange={e=>set('move_in_date',e.target.value)} placeholder="Immediate / 1 Oct"/></label><label>Tenure<input value={f.tenure} onChange={e=>set('tenure',e.target.value)} placeholder="12 months"/></label><label className="span-2">Anything else?<textarea value={f.notes} onChange={e=>set('notes',e.target.value)} placeholder="Furnished, parking, meeting room access…"/></label><div className="seed-actions"><button type="button" className="btn ghost" onClick={()=>setStep(1)}>Back</button><button type="button" className="btn primary" onClick={()=>setStep(3)}>Review <ArrowRight size={15}/></button></div></div>}
   {step===3&&<div className="seed-review"><div className="review-card"><div className="review-title"><div className="lead-avatar">{(f.company||'LE').slice(0,2).toUpperCase()}</div><div><b>{f.company||'New lead'}</b><span>{f.contact||'No contact name'} · {f.channel}</span></div></div><div className="review-grid"><div><small>Need</small><b>{String(f.product_type).replaceAll('_',' ')}</b></div><div><small>Seats</small><b>{f.seats}</b></div><div><small>Location</small><b>{f.market}</b></div><div><small>Budget</small><b>{fmt(f.budget)}</b></div><div><small>Move-in</small><b>{f.move_in_date}</b></div><div><small>Tenure</small><b>{f.tenure}</b></div></div></div><div className="review-flow"><span>CRM</span><ArrowRight/><span>Qualify</span><ArrowRight/><span>Match</span><ArrowRight/><span>Shortlist</span><ArrowRight/><span>Warm</span><ArrowRight/><span>Human</span></div><div className="seed-actions"><button type="button" className="btn ghost" onClick={()=>setStep(2)}>Back</button><button disabled={busy} className="btn primary"><Play size={14}/>{busy?'Running…':'Seed lead & run automation'}</button></div></div>}
  </form>}
 </section>
}
function LeadDrawer({lead,data,onClose,refresh,setToast,fmt=money}){
 const [detail,setDetail]=useState(data||{lead,requirement:{},matches:[]});
 const [activities,setActivities]=useState([]);
 const [summary,setSummary]=useState(null);
 const [brief,setBrief]=useState(null);
 const [busy,setBusy]=useState('');
 const [note,setNote]=useState('');
 const load=async()=>{try{const [m,a]=await Promise.all([api.matches(lead.id),api.activities(lead.id)]);setDetail(m);setActivities(a)}catch(e){setToast(e.message)}};
 useEffect(()=>{load()},[lead.id]);
 // P3: a lead-scoped subscription, so an action taken by automation or by another
 // rep while this drawer is open lands in the timeline immediately. Scoped rather
 // than filtering the global feed client-side, so the drawer never has to receive
 // and discard every other lead's traffic.
 useEffect(()=>openStream({leadId:lead.id,onFrame:f=>{
   if(f.kind==='activity'&&f.activity)setActivities(prev=>prev.some(a=>a.id===f.activity.id)?prev:[f.activity,...prev]);
   if(f.kind==='lead'&&f.lead)setDetail(d=>d?{...d,lead:{...d.lead,...f.lead}}:d);
 }}),[lead.id]);
 const l=detail?.lead||lead, r=detail?.requirement||{}, ms=detail?.matches||[];
 const action=async(name,fn,success)=>{setBusy(name);try{await fn();await load();await refresh();setToast(success)}catch(e){setToast(e.message)}finally{setBusy('')}};
 const toggleVoice=()=>action('voice',()=>api.updateLead(l.id,{voice_enabled:l.voice_enabled===false}),l.voice_enabled===false?'Voice enabled for this lead':'Voice disabled for this lead');
 const sendShortlist=()=>action('shortlist',()=>api.shortlist(l.id),'Shortlist sent to the lead');
 const warm=()=>action('warm',()=>api.warm(l.id),'Lead moved to warm');
 const handoff=()=>action('handoff',()=>api.handoff(l.id),'Human handoff created');
 const automate=()=>action('automate',()=>api.automate(l.id),'Automation run completed');
 const ai=async()=>{setBusy('ai');try{setSummary(await api.aiSummary(l.id));}catch(e){setToast(e.message)}finally{setBusy('')}};
 const viewBrief=async()=>{setBusy('brief');try{setBrief(await api.brief(l.id));}catch(e){setToast(e.message)}finally{setBusy('')}};
 const addNote=async()=>{if(!note.trim())return;await action('note',()=>api.addActivity({lead_id:l.id,type:'NOTE',title:'Rep note',body:note.trim()}),'Note added');setNote('')};
 return <div className="drawer-back" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><aside className="drawer" onMouseDown={e=>e.stopPropagation()}>
  <div className="drawer-head"><div><Badge tone={stageTone[l.stage]||'gray'}>{l.stage}</Badge><h2>{l.company}</h2><span>{l.contact||'No contact'} · {l.channel||l.source||'web'}</span></div><button className="icon-btn" onClick={onClose}><X size={19}/></button></div>
  <div className="drawer-body">
   <div className="mini-grid"><div><span>Fit score</span><b>{l.score??'—'}</b></div><div><span>Voice</span><b>{l.voice_enabled===false?'Off':'On'}</b></div><div><span>Source</span><b>{l.source||l.channel||'web'}</b></div></div>
   {l.next_action&&<div className="ai-decision"><div className="eyebrow">NIA recommendation</div><div className="ai-decision-row"><b style={{textTransform:'capitalize'}}>{l.next_action.replaceAll('_',' ').toLowerCase()}</b><Badge tone={l.next_action_priority==='HIGH'?'red':l.next_action_priority==='MEDIUM'?'amber':'gray'}>{l.next_action_priority||'—'}</Badge>{l.next_action_requires_human&&<Badge tone="blue">needs human</Badge>}</div><p>{l.next_action_reason}</p></div>}
   <div className="drawer-section"><h3>Quick actions</h3><div className="drawer-actions"><button className={`btn ${l.voice_enabled===false?'ghost':'dark'}`} disabled={busy==='voice'} onClick={toggleVoice}><PhoneCall size={14}/>{busy==='voice'?'Saving…':l.voice_enabled===false?'Turn voice on':'Turn voice off'}</button><button className="btn primary" disabled={!ms.length||busy==='shortlist'} onClick={sendShortlist}><Send size={14}/>{busy==='shortlist'?'Sending…':'Send shortlist'}</button></div><div className="drawer-actions"><button className="btn ghost" disabled={busy==='warm'} onClick={warm}><Zap size={14}/>Warm lead</button><button className="btn ghost" disabled={busy==='handoff'} onClick={handoff}><UserRound size={14}/>Handoff</button><button className="btn ghost" disabled={busy==='automate'} onClick={automate}><Workflow size={14}/>Run automation</button></div></div>
   <div className="drawer-section"><div className="section-inline"><h3>Requirement</h3><button className="text-btn" onClick={ai} disabled={busy==='ai'}><Sparkles size={13}/>{busy==='ai'?'Thinking…':'AI summary'}</button></div><div className="req-grid"><div><span>Workspace</span><b>{String(r.product_type||'—').replaceAll('_',' ')}</b></div><div><span>Seats</span><b>{r.seats||'—'}</b></div><div><span>Market</span><b>{r.market||'—'}</b></div><div><span>Budget</span><b>{r.budget?fmt(r.budget):'—'}</b></div><div><span>Move-in</span><b>{r.move_in_date||'—'}</b></div><div><span>Tenure</span><b>{r.tenure||'—'}</b></div></div>
    {(r.objections?.length>0||r.competitor)&&<div className="req-flags">{r.objections?.map(o=><Badge key={o} tone="amber">{o.toLowerCase()} objection</Badge>)}{r.competitor&&<Badge tone="red">vs {r.competitor.name}{r.competitor.quoted_price?` · ₹${Number(r.competitor.quoted_price).toLocaleString('en-IN')}`:''}</Badge>}</div>}
   </div>
   {summary&&<div className="ai-summary"><div className="eyebrow">AI working note</div><p>{summary.summary}</p><div className="ai-next"><b>Next:</b> {summary.next_action}</div>{summary.missing?.length>0&&<small>Missing: {summary.missing.join(', ')}</small>}</div>}
   {l.next_action_requires_human&&<div className="drawer-section"><div className="section-inline"><h3>KAM briefing</h3><button className="text-btn" onClick={viewBrief} disabled={busy==='brief'}><Sparkles size={13}/>{busy==='brief'?'Preparing…':'Generate brief'}</button></div>{brief&&<div className="ai-summary"><p><b>{brief.company}</b> — {brief.requirement_summary}</p><p>{brief.recommended_action}</p><p><i>"{brief.suggested_opener}"</i></p></div>}</div>}
   <div className="drawer-section"><div className="section-inline"><h3>Matched inventory</h3><Badge tone="green">{ms.length} grounded</Badge></div>{ms.map(m=><div className="match" key={m.id}><div><b>{m.unit}</b><small>{m.centre} · {m.market} · {m.seats} seats · {fmt(m.price)}</small></div><Badge tone="blue">{m.score} fit</Badge></div>)}{!ms.length&&<Empty title="No exact match" text="Run inventory matching after adding more requirements or inventory."/>}</div>
   <div className="drawer-section"><h3>Conversation note</h3><textarea className="drawer-note" rows="3" value={note} onChange={e=>setNote(e.target.value)} placeholder="Add a short note for the next teammate…"/><div className="drawer-actions"><button className="btn ghost" disabled={!note.trim()||busy==='note'} onClick={addNote}><StickyNote size={14}/>Add note</button></div></div>
   <div className="drawer-section"><h3>Activity</h3><div className="activity-list">{activities.map(a=><div className="activity" key={a.id}><div className="activity-dot"><CheckCircle2 size={12}/></div><div><b>{a.title}</b><span>{a.body}</span><small>{new Date(a.created_at).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</small></div></div>)}{!activities.length&&<Empty title="No activity yet" text="Actions on this lead will appear here."/>}</div></div>
  </div>
 </aside></div>
}

function Dashboard({leads,inventory,bookings,tours,handoffs,demand,setTab,setSelected,refresh,setToast}){
 const warm=leads.filter(l=>l.stage==='WARM').length,open=handoffs.filter(h=>h.status==='OPEN').length,active=inventory.reduce((s,x)=>s+Number(x.available||0),0);
 const confirmedBookings=bookings.filter(b=>b.status==='CONFIRMED').slice(0,4),confirmedTours=tours.filter(t=>t.status==='CONFIRMED').slice(0,4);
 const leadFor=id=>leads.find(l=>l.id===id), invFor=id=>inventory.find(i=>i.id===id);
 const totalDemand=demand.reduce((s,x)=>s+Number(x.demand||0),0), totalSupply=demand.reduce((s,x)=>s+Number(x.available||0),0), totalGap=demand.reduce((s,x)=>s+Number(x.gap||0),0);
 const coverage=totalDemand?Math.min(100,Math.round(totalSupply/totalDemand*100)):100;
 const hour=new Date().getHours(), greeting=hour<12?'Good morning':hour<17?'Good afternoon':'Good evening';
 const kam=(handoffs.find(h=>h.owner)?.owner||'').split(' ')[0]||'there';
 const openHandoffs=handoffs.filter(h=>h.status==='OPEN');
 const priorityLeads=[...leads].filter(l=>['WARM','MATCHED','QUALIFYING'].includes(l.stage)).sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,5);
 const actionFor=l=>{const h=openHandoffs.find(x=>x.lead_id===l.id);if(h)return{icon:PhoneCall,text:'Call now',tone:'amber',sla:'10 min SLA'};if(l.stage==='MATCHED')return{icon:CheckCircle2,text:'Share shortlist',tone:'blue',sla:'Today'};return{icon:Clock3,text:'Continue qualifying',tone:'gray',sla:'This week'}};
 return <>
  <div className="dashboard-welcome"><div><div className="eyebrow">{greeting}, {kam}</div><h2>Here's what needs your attention today.</h2><p>Leads, follow-ups, inventory demand, bookings and tours — without switching between tools.</p></div><div className="dashboard-actions"><button className="btn ghost" onClick={refresh}><RefreshCw size={14}/> Refresh</button><button className="btn primary" onClick={()=>setTab('leads')}><Plus size={14}/> New lead</button></div></div>
  <div className="grid metrics metrics-3"><Metric label="Leads" value={leads.length} sub={`${leads.filter(l=>['QUALIFYING','MATCHED'].includes(l.stage)).length} qualifying`} icon={Users}/><Metric label="Warm" value={warm} sub="ready for follow-up" icon={CheckCircle2}/><Metric label="Handoffs" value={open} sub="10 min SLA" icon={AlertTriangle}/></div>
  <section className="card"><div className="card-head"><div><h2>Today's actions</h2><p>Ranked by fit and urgency — the work that needs a person today.</p></div><Badge tone={priorityLeads.length?'amber':'green'}>{priorityLeads.length?'Action-first':'All caught up'}</Badge></div><div className="today-actions">{priorityLeads.map(l=>{const a=actionFor(l);const Icon=a.icon;return <div className="today-action-row" key={l.id}><div className="lead-cell"><div className="lead-avatar">{(l.company||'?').slice(0,2).toUpperCase()}</div><div><b>{l.company}</b><small>{l.contact||'—'}</small></div></div><div className="today-action-what"><Icon size={14}/> {a.text}</div><Badge tone={a.tone}>{a.sla}</Badge><button className="btn small primary" onClick={()=>{setSelected(l);setTab('leads')}}>Open</button></div>})}{!priorityLeads.length&&<Empty title="Nothing urgent" text="New leads and warm follow-ups will show up here first."/>}</div></section>
  <div className="grid two dashboard-ops">
   <section className="card"><div className="card-head"><div><h2>Bookings</h2><p>Upcoming reservations.</p></div><Badge tone="green">{confirmedBookings.length} upcoming</Badge></div><div className="mini-list">{confirmedBookings.map(b=><div className="mini-row" key={b.id}><div className="mini-date"><b>{b.date?.slice(5)||'—'}</b><span>{b.time||'—'}</span></div><div className="mini-main"><b>{leadFor(b.lead_id)?.company||'Lead'}</b><span>{invFor(b.inventory_id)?.unit||'Workspace'} · {b.seats} seats</span></div><Badge tone="green">Confirmed</Badge></div>)}{!confirmedBookings.length&&<Empty title="No bookings yet" text="Bookings will appear here when a lead reserves inventory."/>}<button className="text-btn dashboard-ops-link" onClick={()=>setTab('bookings')}>View all bookings <ChevronRight size={15}/></button></div></section>
   <section className="card"><div className="card-head"><div><h2>Tours</h2><p>Upcoming visits.</p></div><Badge tone="blue">{confirmedTours.length} upcoming</Badge></div><div className="mini-list">{confirmedTours.map(t=><div className="mini-row" key={t.id}><div className="mini-date"><b>{t.date?.slice(5)||'—'}</b><span>{t.time||'—'}</span></div><div className="mini-main"><b>{leadFor(t.lead_id)?.company||'Lead'}</b><span>{invFor(t.inventory_id)?.unit||'Workspace'} · {t.mode==='in_person'?'In person':'Virtual'}</span></div><Badge tone="blue">Tour</Badge></div>)}{!confirmedTours.length&&<Empty title="No tours yet" text="Schedule a tour from a matched lead."/>}<button className="text-btn dashboard-ops-link" onClick={()=>setTab('tours')}>View all tours <ChevronRight size={15}/></button></div></section>
  </div>
  <section className="card dashboard-demand dashboard-demand-primary"><div className="card-head"><div><h2>Demand gap</h2><p>What customers are asking for that your current inventory cannot cover.</p></div><div className="demand-summary"><span><b>{totalDemand}</b> demand</span><span><b>{coverage}%</b> covered</span><Badge tone={totalGap?'amber':'green'}>{totalGap?`${totalGap} gap`:'Covered'}</Badge></div></div><div className="dashboard-demand-head"><span>Market</span><span>Demand</span><span>Coverage</span><span>Gap</span></div><div className="dashboard-demand-grid">{demand?.slice(0,5).map((d,i)=>{const pct=Math.min(100,Math.round(Number(d.available||0)/Math.max(1,Number(d.demand||0))*100));return <div className="dashboard-demand-row" key={i}><div><b>{d.market||'Any market'}</b><span>{String(d.product_type||'workspace').replaceAll('_',' ')} · {d.seats} seats</span></div><strong>{d.demand}</strong><div className="coverage"><div><i style={{width:`${pct}%`}}/></div><small>{pct}% covered</small></div><Badge tone={d.gap?'red':'green'}>{d.gap?`${d.gap} gap`:'Covered'}</Badge></div>})}{!demand?.length&&<Empty title="No demand gap yet" text="Add a lead in the Lead Inbox and the demand view will update automatically."/>}</div><button className="text-btn dashboard-ops-link" onClick={()=>setTab('demand')}>Open full demand gap view <ChevronRight size={15}/></button></section>
  <div className="grid two">
   <section className="card"><div className="card-head"><div><h2>Lead pipeline</h2><p>See where every lead is in the journey.</p></div><button className="text-btn" onClick={()=>setTab('leads')}>Open Lead Inbox <ChevronRight size={15}/></button></div><div className="funnel">{['CAPTURED','QUALIFYING','MATCHED','SHORTLIST','NURTURING','WARM'].map(s=>{const n=leads.filter(l=>l.stage===s).length;return <div className="funnel-row" key={s}><span>{s}</span><div><i style={{width:`${Math.max(5,leads.length?100*n/leads.length:5)}%`}}/></div><b>{n}</b></div>})}</div></section>
   <section className="card dashboard-handoffs"><div className="card-head"><div><h2>Human handoff</h2><p>Warm leads that need a person to take over.</p></div><Badge tone={open?'amber':'green'}>{open?`${open} waiting`:'All clear'}</Badge></div><div className="mini-list">{openHandoffs.slice(0,3).map(h=><div className="mini-row" key={h.id}><div className="mini-date"><AlertTriangle size={15}/></div><div className="mini-main"><b>{leadFor(h.lead_id)?.company||'Lead'}</b><span>{h.reason||'Qualified lead'} · {h.owner||'Unassigned'}</span></div><Badge tone="amber">10 min SLA</Badge><button className="btn small primary" onClick={()=>{setTab('leads');const l=leadFor(h.lead_id);if(l)setSelected(l)}}>Open</button></div>)}{!open&&<Empty title="No handoffs waiting" text="When automation warms a lead, it will appear here."/>}</div></section>
  </div>
  <section className="card"><div className="card-head"><div><h2>Recent leads</h2><p>Latest demand entering Deskline.</p></div><button className="text-btn" onClick={()=>setTab('leads')}>Open inbox <ChevronRight size={15}/></button></div><LeadTable leads={leads.slice(0,6)} onSelect={l=>{setSelected(l);setTab('leads')}}/></section>
 </>
}
function Today({leads,setSelected}){const rows=[...leads].filter(x=>['WARM','MATCHED','QUALIFYING'].includes(x.stage)).sort((a,b)=>(b.score||0)-(a.score||0));return <section className="card"><div className="card-head"><div><h2>Priority queue</h2><p>Ranked by fit and funnel urgency.</p></div><Badge tone="amber">Action-first</Badge></div><div className="today-list">{rows.map((l,i)=><div className="today-row" key={l.id}><div className="rank">{i+1}</div><div className="today-main"><b>{l.company}</b><span>{l.contact} · {l.channel}</span></div><Badge tone={stageTone[l.stage]}>{l.stage}</Badge><div className="today-score"><b>{l.score??'—'}</b><small>fit</small></div><button className="btn small primary" onClick={()=>setSelected(l)}>Open</button></div>)}</div></section>}
function roomImage(type){
 const t=(type||'').toLowerCase();
 if(t.includes('meeting')) return '/room-meeting.svg';
 if(t.includes('desk')) return '/room-desk.svg';
 return '/room-office.svg';
}
function Inventory({inventory,refresh,setToast,fmt=money}){const [open,setOpen]=useState(false),[f,setF]=useState({centre:'Vantage Workspaces',unit:'',product_type:'private_office',market:'Gurgaon',seats:8,price:12500,available:1,amenities:'WiFi;AC'});const submit=async e=>{e.preventDefault();try{await api.addInventory({...f,amenities:f.amenities.split(';')});await refresh();setToast('Inventory added');setOpen(false)}catch(e){setToast(e.message)}};const csv=async e=>{const file=e.target.files?.[0];if(!file)return;const text=await file.text();const [head,...lines]=text.trim().split(/\r?\n/),keys=head.split(',').map(x=>x.trim());const rows=lines.map(line=>{const vals=line.split(',');return Object.fromEntries(keys.map((k,i)=>[k,vals[i]?.trim()||'']))});try{const r=await api.importInventory(rows);await refresh();setToast(`${r.created} inventory units imported`)}catch(e){setToast(e.message)}};return <><div className="toolbar"><div className="toolbar-copy"><b>Inventory control</b><span>{inventory.length} units · grounded source of truth</span></div><div className="toolbar-actions"><label className="btn ghost"><Upload size={15}/> Import CSV<input hidden type="file" accept=".csv" onChange={csv}/></label><button className="btn primary" onClick={()=>setOpen(true)}><Plus size={15}/> Add unit</button></div></div><div className="inventory-list">{inventory.map(i=><article className="inventory-vertical" key={i.id}><img src={roomImage(i.product_type)} alt={i.product_type}/><div className="inv-body"><div className="inv-top"><Badge tone={i.available>0?'green':'red'}>{i.available>0?`${i.available} available`:'Sold out'}</Badge><span className="mono">{i.id}</span></div><h3>{i.unit}</h3><p>{i.centre} · {i.market}</p><div className="inv-details"><div><span>Product</span><b>{String(i.product_type||'office').replaceAll('_',' ')}</b></div><div><span>Seats</span><b>{i.seats}</b></div><div><span>Price</span><b>{fmt(i.price)}</b></div><div><span>Floor</span><b>{fmt(i.floor_price)}</b></div><div><span>Available from</span><b>{i.available_from||'Now'}</b></div></div><div className="amenities">{(i.amenities||[]).map(a=><span key={a}>{a}</span>)}</div></div></article>)}</div>{open&&<Modal title="Add inventory" onClose={()=>setOpen(false)}><form className="form" onSubmit={submit}><div className="form-grid"><label>Centre<input value={f.centre} onChange={e=>setF({...f,centre:e.target.value})}/></label><label>Unit<input required value={f.unit} onChange={e=>setF({...f,unit:e.target.value})}/></label><label>Product<select value={f.product_type} onChange={e=>setF({...f,product_type:e.target.value})}><option>private_office</option><option>meeting_room</option><option>dedicated_desk</option><option>cabin</option></select></label><label>Market<input required value={f.market} onChange={e=>setF({...f,market:e.target.value})}/></label><label>Seats<input type="number" required value={f.seats} onChange={e=>setF({...f,seats:e.target.value})}/></label><label>Price<input type="number" required value={f.price} onChange={e=>setF({...f,price:e.target.value})}/></label><label>Available<input type="number" value={f.available} onChange={e=>setF({...f,available:e.target.value})}/></label><label>Amenities<input value={f.amenities} onChange={e=>setF({...f,amenities:e.target.value})}/></label></div><div className="modal-actions"><button type="button" className="btn ghost" onClick={()=>setOpen(false)}>Cancel</button><button className="btn primary">Save inventory</button></div></form></Modal>}</>}

function Bookings({bookings,leads,inventory}){return <section className="card"><div className="card-head"><div><h2>Bookings</h2><p>Confirmed inventory reservations.</p></div></div><div className="timeline">{bookings.map(b=><div className="timeline-row" key={b.id}><div className="time"><b>{b.date}</b><span>{b.time}</span></div><div className="timeline-dot"/><div className="tour-main"><b>{leads.find(l=>l.id===b.lead_id)?.company||b.lead_id}</b><span>{inventory.find(i=>i.id===b.inventory_id)?.unit||b.inventory_id} · {b.seats} seats · {b.reference}</span></div><Badge tone={b.status==='CONFIRMED'?'green':'amber'}>{b.status}</Badge></div>)}{!bookings.length&&<Empty title="No bookings" text="Bookings created from matched inventory will appear here."/>}</div></section>}
function Tours({tours,leads,inventory}){return <section className="card"><div className="card-head"><div><h2>Tours</h2><p>Site visits and virtual tours.</p></div></div><div className="timeline">{tours.map(t=><div className="timeline-row" key={t.id}><div className="time"><b>{t.date}</b><span>{t.time}</span></div><div className="timeline-dot"/><div className="tour-main"><b>{leads.find(l=>l.id===t.lead_id)?.company||t.lead_id}</b><span>{inventory.find(i=>i.id===t.inventory_id)?.unit||t.inventory_id} · {t.mode}</span></div><Badge tone="green">{t.status}</Badge></div>)}{!tours.length&&<Empty title="No tours scheduled" text="Schedule tours from the lead workflow."/>}</div></section>}
function Handoffs({handoffs,leads,refresh,setToast}){const resolve=async h=>{try{await api.updateHandoff(h.id,{status:'RESOLVED'});await refresh();setToast('Handoff resolved')}catch(e){setToast(e.message)}};return <><div className="grid metrics"><Metric label="Open" value={handoffs.filter(h=>h.status==='OPEN').length} sub="within SLA queue" icon={AlertTriangle}/><Metric label="Resolved" value={handoffs.filter(h=>h.status==='RESOLVED').length} sub="human actions complete" icon={CheckCircle2}/><Metric label="SLA target" value="10m" sub="warm lead response" icon={Clock3}/></div><section className="card"><div className="card-head"><div><h2>Handoff queue</h2><p>Warm leads requiring human ownership.</p></div><Badge tone="amber">10 min SLA</Badge></div>{handoffs.map(h=><div className="handoff" key={h.id}><div className="priority">{h.status==='OPEN'?<AlertTriangle size={16}/>:<CheckCircle2 size={16}/>}</div><div className="handoff-main"><b>{leads.find(l=>l.id===h.lead_id)?.company||h.lead_id}</b><span>{h.reason||'Qualified lead'} · owner {h.owner||'unassigned'}</span></div><Badge tone={h.status==='OPEN'?'amber':'green'}>{h.status}</Badge>{h.status==='OPEN'&&<button className="btn small primary" onClick={()=>resolve(h)}>Take over</button>}</div>)}</section></>}
function Automation({cadence,automation,refresh,setToast}){const [cfg,setCfg]=useState(automation||{});useEffect(()=>setCfg(automation||{}),[automation]);const toggle=async key=>{const next={...cfg,[key]:!cfg[key]};try{await api.updateAutomation(next);setCfg(next);await refresh();setToast(`${key} ${next[key]?'enabled':'disabled'}`)}catch(e){setToast(e.message)}};const gates=[['autoQualify','Auto-qualify','CRM lead → requirement extraction'],['autoMatch','Auto-match','Requirement → grounded inventory'],['autoShortlist','Auto-shortlist','Top 3 → send shortlist'],['autoNurture','Auto-nurture','Shortlist → warm-up cadence'],['autoHandover','Auto-handover','Warm → human queue']];return <><div className="automation-hero"><div><div className="eyebrow">Control plane · global</div><h2>Automation engine</h2><p>Run qualification, matching, shortlist, warming and human handoff as one connected flow — across every market.</p></div><Badge tone={cfg.enabled!==false?'green':'gray'}>{cfg.enabled!==false?'Automation ON':'Automation paused'}</Badge></div><div className="automation-flow">{['CRM entry','Live qualify','Match inventory','Send shortlist','Warm lead','Human handoff'].map((x,i)=><div key={x}><span>{i+1}</span><b>{x}</b>{i<5&&<ArrowRight size={14}/>}</div>)}</div><div className="grid two"><section className="card"><div className="card-head"><div><h2>Funnel gates</h2><p>Control each automated transition.</p></div></div><div className="gate"><div><b>Live qualify</b><span>Turn real-time qualification on/off.</span></div><button className={`switch ${cfg.liveQualify?'on':''}`} onClick={()=>toggle('liveQualify')}><i/></button><Badge tone={cfg.liveQualify?'green':'gray'}>{cfg.liveQualify?'ON':'OFF'}</Badge></div>{gates.map(([key,a,b])=><div className="gate" key={key}><div><b>{a}</b><span>{b}</span></div><button className={`switch ${cfg[key]?'on':''}`} onClick={()=>toggle(key)}><i/></button><Badge tone={cfg[key]?'blue':'gray'}>{cfg[key]?'ON':'OFF'}</Badge></div>)}</section><section className="card"><div className="card-head"><div><h2>Cadence policy</h2><p>Follow-up sequence after shortlist/warm.</p></div></div>{cadence.map(c=><div className="cadence" key={c.id}><b>{c.offset}</b><span>{c.channel}</span><span>{c.action}</span><Badge tone={c.enabled===false?'gray':'green'}>{c.enabled===false?'OFF':'ON'}</Badge></div>)}</section></div></>}

function DemandGap({demand,leads,inventory}){
 const totalDemand=demand.reduce((s,x)=>s+Number(x.demand||0),0), totalSupply=demand.reduce((s,x)=>s+Number(x.available||0),0), totalGap=demand.reduce((s,x)=>s+Number(x.gap||0),0);
 const coverage=totalDemand?Math.min(100,Math.round(totalSupply/totalDemand*100)):100;
 return <><div className="demand-hero"><div><div className="eyebrow">Supply intelligence</div><h2>Where demand is not being met</h2><p>Deskline compares what leads are asking for with the inventory that is actually available.</p></div><Badge tone={totalGap?'amber':'green'}>{totalGap?`${totalGap} unmet demand`:'Demand covered'}</Badge></div>
 <div className="grid metrics demand-metrics"><Metric label="Demand" value={totalDemand} sub="units requested by leads" icon={Target}/><Metric label="Available supply" value={totalSupply} sub="matching units" icon={Building2}/><Metric label="Coverage" value={`${coverage}%`} sub="demand covered" icon={CheckCircle2}/><Metric label="Gap" value={totalGap} sub="units to source" icon={AlertTriangle}/></div>
 <section className="card demand-card"><div className="card-head"><div><h2>Demand vs supply</h2><p>Grouped by market, workspace type and seat requirement.</p></div><div className="demand-legend"><span><i className="legend-demand"/>Demand</span><span><i className="legend-supply"/>Available</span></div></div><div className="demand-table"><div className="demand-head"><span>Requirement</span><span>Demand</span><span>Available</span><span>Coverage</span><span>Gap</span></div>{demand.map((d,i)=>{const pct=Math.min(100,Math.round(Number(d.available||0)/Math.max(1,Number(d.demand||0))*100));return <div className="demand-row" key={i}><div><b>{d.market||'Any market'}</b><small>{String(d.product_type||'workspace').replaceAll('_',' ')} · {d.seats} seats</small></div><strong>{d.demand}</strong><strong>{d.available}</strong><div className="coverage"><div><i style={{width:`${pct}%`}}/></div><small>{pct}%</small></div><Badge tone={d.gap?'red':'green'}>{d.gap?`${d.gap} gap`:'Covered'}</Badge></div>})}{!demand.length&&<Empty title="No demand yet" text="Add leads in the Seed Demo or connect your CRM to start seeing gaps."/>}</div></section>
 <div className="grid two"><section className="card"><div className="card-head"><div><h2>What this means</h2><p>Simple actions for the sales team.</p></div></div><div className="gap-actions"><div><Target size={17}/><div><b>Capture unmet demand</b><span>{totalGap} units have no matching available supply.</span></div></div><div><Building2 size={17}/><div><b>Source inventory</b><span>Prioritise the markets and room types with repeated gaps.</span></div></div><div><Zap size={17}/><div><b>Route leads</b><span>Use alternatives when exact inventory is unavailable.</span></div></div></div></section><section className="card"><div className="card-head"><div><h2>Demand signals</h2><p>Live from CRM leads.</p></div></div><div className="signal-list"><div><b>{leads.length}</b><span>leads contributing demand</span></div><div><b>{new Set(leads.map(l=>l.channel)).size}</b><span>lead sources</span></div><div><b>{inventory.length}</b><span>inventory units checked</span></div></div></section></div></>
}
function Analytics({analytics,leads,inventory,bookings}){return <><div className="grid metrics"><Metric label="Conversion" value={`${analytics.conversion_rate??0}%`} sub="lead → warm" icon={BarChart3}/><Metric label="Avg score" value={analytics.avg_score??0} sub="pipeline fit" icon={Target}/><Metric label="Booked" value={bookings.filter(b=>b.status==='CONFIRMED').length} sub="confirmed" icon={CalendarDays}/><Metric label="Inventory fit" value={`${analytics.inventory_fit_rate??0}%`} sub="leads with match" icon={Building2}/></div><div className="grid two"><section className="card"><div className="card-head"><div><h2>Stage distribution</h2><p>Current pipeline shape.</p></div></div><div className="bars">{['CAPTURED','QUALIFYING','MATCHED','SHORTLIST','NURTURING','WARM'].map(s=><div className="bar-row" key={s}><span>{s}</span><div><i style={{height:`${Math.max(4,(leads.filter(l=>l.stage===s).length/Math.max(1,leads.length))*140)}px`}}/></div><b>{leads.filter(l=>l.stage===s).length}</b></div>)}</div></section><section className="card"><div className="card-head"><div><h2>Operating guarantees</h2><p>Controls reflected in this build.</p></div></div>{['Tenant-scoped data access','Grounded inventory matching','Persistent booking records','Explicit human handoff','Quiet-hours cadence policy'].map(x=><div className="guarantee" key={x}><ShieldCheck size={17}/><span>{x}</span><CheckCircle2 size={15}/></div>)}</section></div></>}
// ---------------------------------------------------------------------------
// P3 — Live Feed
// ---------------------------------------------------------------------------
// The pushed frames plus a one-shot fetch of recent history, so the screen is
// useful the second it opens rather than only after the next thing happens.
const FEED_FILTERS=[
 ['ALL','Everything',()=>true],
 ['DECISION','Decisions',f=>f.kind==='event'&&['DECISION','SCORE_UPDATED'].includes(f.event?.event_type)],
 ['VOICE','Voice',f=>f.kind==='event'&&String(f.event?.event_type||'').startsWith('VOICE')],
 ['MESSAGE','Messages',f=>f.kind==='event'&&String(f.event?.event_type||'').startsWith('MESSAGE')],
 ['HANDOFF','Handoffs & SLA',f=>f.kind==='event'&&/HANDOFF|SLA|ESCALAT/.test(String(f.event?.event_type||''))],
 ['ACTIVITY','Human-readable',f=>f.kind==='activity'],
];
function LiveFeed({live,leads,setSelected,setTab,setToast}){
 const [history,setHistory]=useState([]);
 const [paused,setPaused]=useState(false);
 const [shown,setShown]=useState([]);
 const [filter,setFilter]=useState('ALL');

 useEffect(()=>{let alive=true;api.events().then(rows=>{if(alive)setHistory(rows.map(e=>({kind:'event',seq:-1,at:e.created_at,lead_id:e.lead_id,event:e,historical:true})))}).catch(()=>{});return()=>{alive=false}},[]);
 // Pausing freezes what is on screen without dropping the connection — a rep
 // reading a row should not have it scroll out from under them, but the stream
 // keeps running so nothing is missed when they resume.
 useEffect(()=>{if(!paused)setShown(live.frames)},[live.frames,paused]);
 const pending=paused?Math.max(0,live.frames.length-shown.length):0;

 const liveIds=new Set(shown.map(f=>f.event?.id||f.activity?.id).filter(Boolean));
 const test=(FEED_FILTERS.find(x=>x[0]===filter)||FEED_FILTERS[0])[2];
 const rows=[...shown,...history.filter(h=>!liveIds.has(h.event?.id))].filter(test).slice(0,200);
 const leadFor=id=>leads.find(l=>l.id===id);
 const openLead=id=>{const l=leadFor(id);if(!l)return;setSelected(l);setTab('leads')};

 return <>
  <div className="inbox-hero live-hero"><div><div className="eyebrow">Real-time · server-sent events</div><h2>Watch NIA work, as it works.</h2><p>Every decision, message, call turn and handoff is pushed the moment it is written — no refreshing, no polling.</p></div><div className="hero-stats"><span><LiveDot status={live.status}/></span><span><b>{live.frames.length}</b> this session</span><span><b>{history.length}</b> recent</span></div></div>
  <section className="card">
   <div className="card-head"><div><h2>Activity stream</h2><p>{rows.length} shown · newest first</p></div>
    <div className="feed-controls">
     <button className={`btn small ${paused?'primary':'ghost'}`} onClick={()=>setPaused(!paused)}>{paused?<><Play size={13}/> Resume{pending?` (${pending})`:''}</>:<><Pause size={13}/> Pause</>}</button>
    </div>
   </div>
   <div className="feed-filters">{FEED_FILTERS.map(([id,label])=><button key={id} type="button" className={filter===id?'chip active':'chip'} onClick={()=>setFilter(id)}>{label}</button>)}</div>
   <div className="feed-list">
    {rows.map((f,i)=><div className={`feed-row${f.historical?' historical':''}`} key={(f.event?.id||f.activity?.id||f.seq)+'_'+i}>
      <div className={`feed-dot ${FRAME_TONE[f.kind]||'gray'}`}/>
      <div className="feed-time">{new Date(f.at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</div>
      <div className="feed-main">
       <b>{frameTitle(f)}</b>
       {frameBody(f)&&<span>{frameBody(f)}</span>}
      </div>
      <Badge tone={FRAME_TONE[f.kind]||'gray'}>{f.kind}</Badge>
      {f.lead_id&&leadFor(f.lead_id)&&<button className="btn small ghost" onClick={()=>openLead(f.lead_id)}>{leadFor(f.lead_id).company}</button>}
     </div>)}
    {!rows.length&&<Empty title={live.status==='live'?'Nothing yet':'Waiting for the stream'} text={live.status==='live'?'Send a message, run automation or start a call and it will appear here instantly.':'The activity stream is connecting to the API.'}/>}
   </div>
   {rows.length>=200&&<p className="feed-note">{FRAME_LIMIT_NOTE}</p>}
  </section>
 </>;
}

// ---------------------------------------------------------------------------
// P4 — Live Call
// ---------------------------------------------------------------------------
// Real audio in and out via the browser's Web Speech API, real slot filling, real
// grounded read-back, real routing. What it is NOT is a phone call: there is no
// carrier leg, and the banner at the top of the screen says so rather than letting
// a demo imply otherwise.
const SPEECH_LANG={en:'en-IN',hi:'hi-IN',ar:'ar-AE',es:'es-ES'};
function LiveCall({leads,setToast,refresh,fmt=money,locale='en'}){
 const [provider,setProvider]=useState(null);
 const [leadId,setLeadId]=useState('');
 const [caller,setCaller]=useState('');
 const [company,setCompany]=useState('');
 const [session,setSession]=useState(null);
 const [script,setScript]=useState(null);
 const [turns,setTurns]=useState([]);
 const [req,setReq]=useState({});
 const [filled,setFilled]=useState([]);
 const [ms,setMs]=useState([]);
 const [decision,setDecision]=useState(null);
 const [listening,setListening]=useState(false);
 const [interim,setInterim]=useState('');
 const [busy,setBusy]=useState(false);
 const [summary,setSummary]=useState(null);
 const [typed,setTyped]=useState('');
 const [latency,setLatency]=useState(null);

 const recRef=useRef(null),speechEndAt=useRef(null),pendingLatency=useRef(null),sendRef=useRef(null),bottom=useRef(null);
 const SR=typeof window!=='undefined'?(window.SpeechRecognition||window.webkitSpeechRecognition):null;
 const canListen=Boolean(SR);
 const canSpeak=typeof window!=='undefined'&&'speechSynthesis' in window;

 useEffect(()=>{api.voiceStatus().then(setProvider).catch(()=>{})},[]);
 useEffect(()=>{bottom.current?.scrollIntoView({block:'nearest'})},[turns.length,interim]);
 useEffect(()=>()=>{try{recRef.current?.abort?.()}catch{}try{window.speechSynthesis?.cancel()}catch{}},[]);

 // Agent speech. `onstart` is the only honest moment to stop the latency clock:
 // it is when the caller would actually begin hearing a reply.
 const speak=(text)=>{
  if(!canSpeak||!text)return;
  try{
   window.speechSynthesis.cancel();
   const u=new SpeechSynthesisUtterance(text);
   u.lang=SPEECH_LANG[locale]||'en-IN';
   u.onstart=()=>{if(speechEndAt.current){const d=Date.now()-speechEndAt.current;pendingLatency.current=d;setLatency(d);speechEndAt.current=null}};
   window.speechSynthesis.speak(u);
  }catch{/* speech synthesis unavailable — transcript still renders */}
 };

 const sendTurn=async(text)=>{
  const utterance=String(text||'').trim();
  if(!session||!utterance||busy)return;
  setBusy(true);setTyped('');
  setTurns(p=>[...p,{from:'caller',text:utterance,at:new Date().toISOString()}]);
  try{
   const body={text:utterance};
   if(pendingLatency.current!=null)body.prev_latency_ms=pendingLatency.current;
   const r=await api.callTurn(session.id,body);
   pendingLatency.current=null;
   setTurns(p=>[...p,{from:'agent',text:r.reply,at:new Date().toISOString(),action:r.decision?.action||null,ask_for:r.ask_for}]);
   setReq(r.requirement||{});setFilled(r.slots_filled||[]);setMs(r.matches||[]);setDecision(r.decision||null);
   speak(r.reply);
   if(r.end_call)await finish('COMPLETED');
   refresh?.();
  }catch(e){setToast?.(e.message)}finally{setBusy(false)}
 };
 useEffect(()=>{sendRef.current=sendTurn});

 const startListening=()=>{
  if(!SR){setToast?.('This browser has no speech recognition — type the turn instead.');return}
  const rec=new SR();
  rec.lang=SPEECH_LANG[locale]||'en-IN';rec.interimResults=true;rec.continuous=false;rec.maxAlternatives=1;
  rec.onresult=(e)=>{
   let final='',partial='';
   for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript;if(e.results[i].isFinal)final+=t;else partial+=t}
   setInterim(partial);
   if(final.trim()){setInterim('');sendRef.current?.(final)}
  };
  rec.onspeechend=()=>{speechEndAt.current=Date.now()};
  rec.onerror=(e)=>{setListening(false);if(e.error!=='no-speech'&&e.error!=='aborted')setToast?.(`Microphone: ${e.error}`)};
  rec.onend=()=>{setListening(false);setInterim('')};
  recRef.current=rec;
  try{rec.start();setListening(true)}catch{setListening(false)}
 };
 const stopListening=()=>{try{recRef.current?.stop()}catch{}setListening(false)};

 const start=async()=>{
  setBusy(true);
  try{
   const payload=leadId?{lead_id:leadId,locale}:{caller:caller.trim(),company:company.trim()||undefined,locale};
   if(!leadId&&!caller.trim()&&!company.trim()){setToast?.('Pick an existing lead or enter a caller number.');setBusy(false);return}
   const r=await api.startCall(payload);
   setSession(r.session);setScript(r.script);setReq(r.requirement||{});
   setTurns([]);setSummary(null);setMs([]);setDecision(null);setLatency(null);setFilled([]);
   pendingLatency.current=null;speechEndAt.current=null;
   speak(r.script.consent);
   refresh?.();
  }catch(e){setToast?.(e.message)}finally{setBusy(false)}
 };

 const finish=async(disposition)=>{
  if(!session)return;
  stopListening();try{window.speechSynthesis?.cancel()}catch{}
  try{
   const body={};if(disposition)body.disposition=disposition;
   if(pendingLatency.current!=null)body.final_latency_ms=pendingLatency.current;
   const r=await api.endCall(session.id,body);
   setSession(r.session);setSummary(r.session);refresh?.();
  }catch(e){setToast?.(e.message)}
 };

 const consent=async(granted)=>{
  if(!session)return;
  setBusy(true);
  try{
   const r=await api.callConsent(session.id,granted);
   setSession(r.session);
   setTurns(p=>[...p,{from:'agent',text:r.reply,at:new Date().toISOString()}]);
   speak(r.reply);
   if(!granted)await finish('CONSENT_DECLINED');
   refresh?.();
  }catch(e){setToast?.(e.message)}finally{setBusy(false)}
 };

 const reset=()=>{setSession(null);setScript(null);setSummary(null);setTurns([]);setReq({});setMs([]);setDecision(null);setLatency(null);setFilled([])};
 const REQ_ROWS=[['product_type','Workspace'],['seats','Seats'],['market','Market'],['budget','Budget'],['move_in_date','Move-in'],['tenure','Tenure']];
 const reqValue=(k)=>{const v=req?.[k];if(v==null||v==='')return '—';if(k==='budget')return fmt(v);if(k==='product_type')return String(v).replaceAll('_',' ');return String(v)};
 const live=session&&session.status==='LIVE';

 return <>
  <div className="voice-hero"><div><div className="eyebrow">Inbound / outbound · BUILD_SPEC 8.1</div><h2>Live call qualification</h2><p>Consent, slot filling, grounded read-back, scoring, routing and transcript — one turn at a time.</p></div>
   {provider&&<Badge tone={provider.configured?'green':'amber'}>{provider.configured?`${provider.provider} connected`:'Simulated call'}</Badge>}
  </div>

  {provider&&!provider.configured&&<div className="voice-notice"><ShieldCheck size={15}/><div><b>No telephony provider is configured, so no phone call is placed or received.</b><span>{canListen?'Your microphone and speakers are real — speech recognition and playback run locally in this browser. Everything downstream (extraction, matching, scoring, routing, transcript) is the production path.':'This browser has no speech recognition, so type each caller turn instead. Everything downstream is unchanged.'}</span></div></div>}

  {!session&&<section className="card voice-start">
   <div className="card-head"><div><h2>Start a call</h2><p>Take an existing lead, or answer a new caller.</p></div></div>
   <div className="form-grid">
    <label className="span-2">Existing lead<select value={leadId} onChange={e=>setLeadId(e.target.value)}><option value="">— new caller —</option>{leads.map(l=><option key={l.id} value={l.id}>{l.company}{l.contact?` · ${l.contact}`:''}</option>)}</select></label>
    {!leadId&&<label>Caller number<input value={caller} onChange={e=>setCaller(e.target.value)} placeholder="+91 98100 00000"/></label>}
    {!leadId&&<label>Company (optional)<input value={company} onChange={e=>setCompany(e.target.value)} placeholder="Acme Labs"/></label>}
   </div>
   <div className="drawer-actions"><button className="btn primary" disabled={busy} onClick={start}><PhoneCall size={15}/>{busy?'Connecting…':'Start call'}</button></div>
   <div className="voice-caps"><span><Mic size={13}/> Speech input {canListen?'available':'unavailable — type instead'}</span><span><Volume2 size={13}/> Speech output {canSpeak?'available':'unavailable — read the transcript'}</span></div>
  </section>}

  {session&&session.status==='AWAITING_CONSENT'&&<section className="card voice-consent">
   <div className="eyebrow">Recording consent · required before any capture</div>
   <p className="consent-line">“{script?.consent}”</p>
   <p className="consent-note">Nothing is captured until the caller answers. Declining stops the AI leg and routes the call to a person.</p>
   <div className="drawer-actions"><button className="btn primary" disabled={busy} onClick={()=>consent(true)}><CheckCircle2 size={14}/> Caller agreed</button><button className="btn ghost" disabled={busy} onClick={()=>consent(false)}><X size={14}/> Caller declined</button></div>
  </section>}

  {session&&session.status!=='AWAITING_CONSENT'&&<div className="grid two voice-live">
   <section className="card voice-transcript">
    <div className="card-head"><div><h2>Transcript</h2><p>{turns.filter(t=>t.from==='caller').length} caller turn{turns.filter(t=>t.from==='caller').length===1?'':'s'}</p></div>
     {latency!=null&&<Badge tone={latency<800?'green':latency<1200?'amber':'red'}><Gauge size={12}/> {latency}ms</Badge>}
    </div>
    <div className="voice-turns">
     {turns.map((t,i)=><div key={i} className={`chat-bubble ${t.from==='caller'?'lead':'agent'}`}><span>{t.text}</span></div>)}
     {interim&&<div className="chat-bubble lead typing"><span>{interim}</span></div>}
     {busy&&<div className="chat-bubble agent typing"><span>Agent is thinking…</span></div>}
     <div ref={bottom}/>
    </div>
    {live&&<div className="voice-controls">
     {canListen
       ? <button className={`btn ${listening?'dark':'primary'}`} onClick={listening?stopListening:startListening}>{listening?<><MicOff size={15}/> Stop</>:<><Mic size={15}/> Hold to talk</>}</button>
       : <input className="voice-type" value={typed} onChange={e=>setTyped(e.target.value)} placeholder="Type the caller's turn…" onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();speechEndAt.current=Date.now();sendTurn(typed)}}}/>}
     {!canListen&&<button className="btn primary" disabled={busy||!typed.trim()} onClick={()=>{speechEndAt.current=Date.now();sendTurn(typed)}}><Send size={14}/></button>}
     <button className="btn ghost" onClick={()=>finish('COMPLETED')}><PhoneOff size={15}/> End call</button>
    </div>}
    {!live&&!summary&&<div className="voice-controls"><button className="btn ghost" onClick={reset}>Start another call</button></div>}
   </section>

   <section className="card">
    <div className="card-head"><div><h2>Filling live</h2><p>Slots extracted from the caller's own words.</p></div>{decision&&<Badge tone={decision.priority==='HIGH'?'red':decision.priority==='MEDIUM'?'amber':'gray'}>{String(decision.action).replaceAll('_',' ').toLowerCase()}</Badge>}</div>
    <div className="req-grid voice-req">{REQ_ROWS.map(([k,label])=><div key={k} className={filled.includes(k)?'just-filled':''}><span>{label}</span><b>{reqValue(k)}</b></div>)}</div>
    {decision&&<div className="ai-decision"><div className="eyebrow">Why this action</div><p>{decision.reason}</p></div>}
    <div className="drawer-section"><div className="section-inline"><h3>Grounded inventory</h3><Badge tone="green">{ms.length} match{ms.length===1?'':'es'}</Badge></div>
     {ms.map(m=><div className="match" key={m.id}><div><b>{m.unit}</b><small>{m.centre} · {m.market} · {m.seats} seats · {fmt(m.price)}</small></div><Badge tone="blue">{m.score} fit</Badge></div>)}
     {!ms.length&&<Empty title="Nothing matched yet" text="The agent only reads back units the matcher actually returned."/>}
    </div>
   </section>
  </div>}

  {summary&&<section className="card voice-summary">
   <div className="card-head"><div><h2>Call summary</h2><p>Written back to the lead timeline.</p></div><Badge tone={summary.disposition==='COMPLETED'?'green':'amber'}>{summary.disposition}</Badge></div>
   <div className="grid metrics metrics-3">
    <Metric label="Duration" value={`${summary.duration_seconds||0}s`} sub={`${summary.turns?.length||0} turns`} icon={Clock3}/>
    <Metric label="Latency p50" value={summary.latency?.p50!=null?`${summary.latency.p50}ms`:'—'} sub="budget 800ms" icon={Gauge}/>
    <Metric label="Latency p95" value={summary.latency?.p95!=null?`${summary.latency.p95}ms`:'—'} sub={summary.latency?.within_budget===false?'over budget':'budget 1200ms'} icon={Gauge}/>
   </div>
   {summary.final_decision&&<div className="ai-decision"><div className="eyebrow">Routing decision</div><div className="ai-decision-row"><b style={{textTransform:'capitalize'}}>{String(summary.final_decision.action).replaceAll('_',' ').toLowerCase()}</b>{summary.final_decision.requires_human&&<Badge tone="blue">needs human</Badge>}</div><p>{summary.final_decision.reason}</p></div>}
   {summary.transcript&&<pre className="voice-transcript-text">{summary.transcript}</pre>}
   <div className="drawer-actions"><button className="btn primary" onClick={reset}><PhoneCall size={14}/> New call</button></div>
  </section>}
 </>;
}
function SettingsPage({health,tenant,locale,currency,market}){return <div className="grid two"><section className="card"><div className="card-head"><div><h2>Tenant & security</h2><p>Global workspace configuration.</p></div></div><div className="settings-row"><span>Tenant</span><b>{tenant?.name||'Vantage Workspaces'}</b></div><div className="settings-row"><span>Tenant ID</span><b>{tenant?.id||'tenant_demo'}</b></div><div className="settings-row"><span>Active market</span><b>{market||'BLR'}</b></div><div className="settings-row"><span>Locale / currency</span><b>{(locale||'en').toUpperCase()} · {currency||'INR'}</b></div><div className="settings-row"><span>Data isolation</span><Badge tone="green">RLS-ready</Badge></div><div className="settings-row"><span>API</span><Badge tone={health?.ok?'green':'red'}>{health?.ok?'Connected':'Offline'}</Badge></div></section><section className="card"><div className="card-head"><div><h2>Integrations</h2><p>Global connectors ready for international rollout.</p></div></div>{['WhatsApp Cloud API','Exotel / Ozonetel','HubSpot / Zoho / Salesforce','Google / Outlook Calendar','Razorpay · Stripe','CSV / OfficeRnD / Nexudus'].map(x=><div className="integration" key={x}><span>{x}</span><Badge tone="gray">Connector ready</Badge></div>)}</section></div>}


function LeadModal({onClose,refresh,setToast}){const [f,setF]=useState({company:'',contact:'',channel:'web'});const submit=async e=>{e.preventDefault();try{await api.seedDemo({company:f.company,contact:f.contact,channel:f.channel,product_type:'private_office',seats:8,market:'Gurgaon',budget:15000,move_in_date:'Immediate',tenure:'12 months',notes:''});await refresh();setToast('Lead created');onClose()}catch(err){setToast(err.message)}};return <Modal title="Create lead" onClose={onClose}><form className="form" onSubmit={submit}><div className="form-grid"><label>Company<input required value={f.company} onChange={e=>setF({...f,company:e.target.value})}/></label><label>Contact<input value={f.contact} onChange={e=>setF({...f,contact:e.target.value})}/></label><label className="full">Channel<select value={f.channel} onChange={e=>setF({...f,channel:e.target.value})}><option value="web">Website</option><option value="whatsapp">WhatsApp</option><option value="meta">Meta</option></select></label></div><div className="modal-actions"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary">Create</button></div></form></Modal>}

function ChatThread({lead,onUpdate,setToast}){
 const [messages,setMessages]=useState([]),[text,setText]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[decision,setDecision]=useState(null);
 const bottomRef=useRef(null);
 const load=async()=>{try{const m=await api.messages(lead.id);setMessages(m)}catch(e){}finally{setLoaded(true)}};
 useEffect(()=>{load()},[lead.id]);
 useEffect(()=>{bottomRef.current?.scrollIntoView({block:'nearest'})},[messages.length]);
 const send=async()=>{
   if(!text.trim()||busy)return; const draft=text.trim(); setText(''); setBusy(true);
   setMessages(prev=>[...prev,{id:'tmp_'+Date.now(),from:'lead',text:draft,at:new Date().toISOString()}]);
   try{const r=await api.sendMessage(lead.id,{from:'lead',text:draft});setMessages(r.messages);setDecision(r.decision||null);onUpdate?.()}
   catch(e){setToast?.(e.message)}finally{setBusy(false)}
 };
 return <div className="chat-thread">
  <div className="chat-thread-head"><div className="lead-avatar">{(lead.company||'?').slice(0,2).toUpperCase()}</div><div className="chat-thread-title"><b>{lead.company}</b><span>{lead.contact||'No contact'} · {lead.channel||lead.source||'web'}</span></div><Badge tone={stageTone[lead.stage]||'gray'}>{lead.stage}</Badge></div>
  {decision&&<div className="chat-decision" title={decision.reason}><Zap size={12}/><b>NIA:</b> {decision.action.replaceAll('_',' ').toLowerCase()}{decision.requires_human&&<Badge tone="amber">needs human</Badge>}</div>}
  <div className="chat-thread-body">
   {!loaded&&<p className="chat-empty">Loading conversation…</p>}
   {loaded&&!messages.length&&<p className="chat-empty">No messages yet — send something as this lead to start the conversation. The agent replies instantly and updates the requirement live.</p>}
   {messages.map(m=><div key={m.id} className={`chat-bubble ${m.from}`}><span>{m.text}</span></div>)}
   {busy&&<div className="chat-bubble agent typing"><span>Agent is typing…</span></div>}
   <div ref={bottomRef}/>
  </div>
  <div className="chat-thread-input">
   <input value={text} onChange={e=>setText(e.target.value)} placeholder="Type as the lead…" onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();send()}}}/>
   <button type="button" className="btn small primary" disabled={busy||!text.trim()} onClick={send}><Send size={13}/></button>
  </div>
 </div>;
}

function Conversations({leads,refresh,setToast}){
 const candidates=[...leads].sort((a,b)=>new Date(b.updated_at||b.created_at)-new Date(a.updated_at||a.created_at));
 const [ids,setIds]=useState([]);
 useEffect(()=>{if(!ids.length&&candidates.length)setIds(candidates.slice(0,4).map(l=>l.id))},[leads.length]);
 const toggle=id=>setIds(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id].slice(-6));
 const open=leads.filter(l=>ids.includes(l.id));
 return <>
  <div className="inbox-hero"><div><div className="eyebrow">Multi-lead conversations</div><h2>Talk to several leads at the same time.</h2><p>Every open thread runs independently — the agent qualifies, matches inventory and replies to each lead in parallel, live.</p></div><div className="hero-stats"><span><b>{open.length}</b> live now</span><span><b>{leads.length}</b> total leads</span></div></div>
  <section className="card"><div className="card-head"><div><h2>Choose leads to run in parallel</h2><p>Pick up to 6 threads to open side by side.</p></div></div><div className="chat-picker">{candidates.map(l=><button type="button" key={l.id} className={ids.includes(l.id)?'chip active':'chip'} onClick={()=>toggle(l.id)}>{l.company}</button>)}{!candidates.length&&<span className="chat-empty">No leads yet — create one from the Lead Inbox.</span>}</div></section>
  {open.length>0&&<div className="chat-grid">{open.map(l=><ChatThread key={l.id} lead={l} onUpdate={refresh} setToast={setToast}/>)}</div>}
  {!open.length&&candidates.length>0&&<Empty title="No conversation open" text="Select one or more leads above to start talking with them at once."/>}
 </>;
}

function Team({team,refresh,setToast}){
 const [open,setOpen]=useState(false),[f,setF]=useState({name:'',email:'',phone:'',role:'Sales Rep',markets:'',capacity:10}),[busy,setBusy]=useState(false);
 const submit=async e=>{e.preventDefault();setBusy(true);try{await api.addTeamMember(f);await refresh();setToast('Team member added');setOpen(false);setF({name:'',email:'',phone:'',role:'Sales Rep',markets:'',capacity:10})}catch(err){setToast(err.message)}finally{setBusy(false)}};
 const onFile=async e=>{
  const file=e.target.files?.[0]; if(!file)return;
  try{
   const buf=await file.arrayBuffer();
   const wb=XLSX.read(buf,{type:'array'});
   const sheet=wb.Sheets[wb.SheetNames[0]];
   const rows=XLSX.utils.sheet_to_json(sheet,{defval:''});
   if(!rows.length){setToast('No rows found in that sheet');e.target.value='';return}
   const r=await api.importTeam(rows);
   await refresh();
   setToast(`${r.created} team member${r.created===1?'':'s'} imported from ${file.name}`);
  }catch(err){setToast(err.message||'Could not read that spreadsheet')}
  e.target.value='';
 };
 return <>
  <div className="toolbar"><div className="toolbar-copy"><b>Team roster</b><span>{team.length} member{team.length===1?'':'s'} · routes handoffs by market and current load</span></div><div className="toolbar-actions"><label className="btn ghost"><Upload size={15}/> Import Excel<input hidden type="file" accept=".xlsx,.xls,.csv" onChange={onFile}/></label><button className="btn primary" onClick={()=>setOpen(true)}><Plus size={15}/> Add member</button></div></div>
  <section className="card team-hint"><Upload size={14}/><p>Upload a spreadsheet with <b>name</b>, <b>email</b>, <b>role</b>, <b>markets</b> and <b>capacity</b> columns — Deskline reads it automatically and adds every teammate to the roster below. Existing automation and handoffs will start routing to them right away.</p></section>
  <div className="team-grid">
   {team.map(u=><article className="team-card" key={u.id}>
    <div className="team-card-top"><div className="avatar">{(u.name||'?').slice(0,2).toUpperCase()}</div><div><b>{u.name}</b><small>{u.role}</small></div></div>
    <div className="team-card-rows"><div><span>Markets</span><b>{(u.markets||[]).join(', ')||'—'}</b></div><div><span>Email</span><b>{u.email||'—'}</b></div><div><span>Phone</span><b>{u.phone||'—'}</b></div></div>
    <div className="team-load"><div><i style={{width:`${Math.min(100,((u.load||0)/Math.max(1,u.capacity||10))*100)}%`}}/></div><span>{u.load||0} / {u.capacity||10} open handoffs</span></div>
   </article>)}
   {!team.length&&<Empty title="No team members yet" text="Import a spreadsheet or add a teammate manually to start routing leads to real people."/>}
  </div>
  {open&&<Modal title="Add team member" onClose={()=>setOpen(false)}><form className="form" onSubmit={submit}><div className="form-grid"><label>Name<input required value={f.name} onChange={e=>setF({...f,name:e.target.value})}/></label><label>Role<select value={f.role} onChange={e=>setF({...f,role:e.target.value})}><option>Sales Rep</option><option>Sales Manager</option><option>Admin</option></select></label><label>Email<input value={f.email} onChange={e=>setF({...f,email:e.target.value})}/></label><label>Phone<input value={f.phone} onChange={e=>setF({...f,phone:e.target.value})}/></label><label className="full">Markets (comma separated)<input value={f.markets} onChange={e=>setF({...f,markets:e.target.value})} placeholder="Golf Course Road, Cyber Hub"/></label><label>Capacity<input type="number" min="1" value={f.capacity} onChange={e=>setF({...f,capacity:e.target.value})}/></label></div><div className="modal-actions"><button type="button" className="btn ghost" onClick={()=>setOpen(false)}>Cancel</button><button disabled={busy} className="btn primary">{busy?'Saving…':'Save teammate'}</button></div></form></Modal>}
 </>;
}

createRoot(document.getElementById('root')).render(<App/>);
