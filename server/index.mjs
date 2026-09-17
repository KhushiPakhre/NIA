import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import * as brain from './nia-brain.mjs';
import * as voice from './voice.mjs';
import * as realtime from './realtime.mjs';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(__dirname,'..');
const dbFile=path.join(root,'data','db.json');
const PORT=Number(process.env.PORT||8787);
const TENANT=process.env.DESKLINE_TENANT_ID||'tenant_demo';
function seed(){return {tenants:[{id:'tenant_demo',name:'Vantage Workspaces',slug:'vantage-workspaces'}],users:[{id:'user_1',tenant_id:'tenant_demo',name:'Priya Nair',email:'priya@vantage-workspaces.com',phone:'+91 98100 00001',role:'Sales Rep',markets:['Golf Course Road','Cyber Hub'],capacity:12,active:true},{id:'user_2',tenant_id:'tenant_demo',name:'Devansh Rao',email:'devansh@vantage-workspaces.com',phone:'+91 98100 00002',role:'Sales Rep',markets:['Sector 44','Nehru Place'],capacity:12,active:true},{id:'user_3',tenant_id:'tenant_demo',name:'Meera Joshi',email:'meera@vantage-workspaces.com',phone:'+91 98100 00003',role:'Sales Manager',markets:['Indiranagar','Koramangala'],capacity:15,active:true}],inventory:[{id:'VW-CAB-704',tenant_id:'tenant_demo',centre:'Vantage Workspaces',unit:'Cabin 704',product_type:'private_office',market:'Golf Course Road',seats:8,price:12500,floor_price:11000,available:4,available_from:null,amenities:['WiFi','AC','24x7 access'],active:true},{id:'VW-MR-44',tenant_id:'tenant_demo',centre:'Qdesq Express',unit:'Express Meeting Room',product_type:'meeting_room',market:'Sector 44',seats:4,price:500,floor_price:450,available:2,available_from:null,amenities:['Display','WiFi','Whiteboard'],active:true},{id:'VW-OFF-12A',tenant_id:'tenant_demo',centre:'Vantage Workspaces',unit:'Private Office 12A',product_type:'private_office',market:'Cyber Hub',seats:12,price:18000,floor_price:16000,available:1,available_from:null,amenities:['Reception','Parking','AC'],active:true}],leads:[{id:'lead_demo_1',tenant_id:'tenant_demo',company:'Northstar Analytics',contact:'Rhea Kapoor',source:'meta',channel:'whatsapp',stage:'WARM',score:84,created_at:'2026-09-15T08:30:00.000Z',updated_at:'2026-09-15T09:05:00.000Z'},{id:'lead_demo_2',tenant_id:'tenant_demo',company:'Orbit Legal',contact:'Aman Verma',source:'portal',channel:'portal',stage:'MATCHED',score:68,created_at:'2026-09-15T10:00:00.000Z',updated_at:'2026-09-15T10:12:00.000Z'},{id:'lead_demo_3',tenant_id:'tenant_demo',company:'Marigold Studio',contact:'Ishita Rao',source:'web',channel:'web',stage:'QUALIFYING',score:54,created_at:'2026-09-15T12:10:00.000Z',updated_at:'2026-09-15T12:20:00.000Z'}],requirements:[{id:'req_1',lead_id:'lead_demo_1',product_type:'private_office',seats:8,market:'Golf Course Road',budget:15000,move_in_date:'Immediate',tenure:'12 months',fit_out:'furnished',notes:'',confidence:{seats:.98,market:.96,budget:.92},version:1,updated_at:'2026-09-15T09:05:00.000Z'},{id:'req_2',lead_id:'lead_demo_2',product_type:'private_office',seats:10,market:'Golf Course Road',budget:18000,move_in_date:'1 Oct',tenure:'24 months',fit_out:'furnished',notes:'',confidence:{seats:.9,market:.9,budget:.95},version:1,updated_at:'2026-09-15T10:12:00.000Z'},{id:'req_3',lead_id:'lead_demo_3',product_type:'dedicated_desk',seats:6,market:'Golf Course Road',budget:14000,move_in_date:'15 Oct',tenure:'12 months',fit_out:'furnished',notes:'',confidence:{seats:.8},version:1,updated_at:'2026-09-15T12:20:00.000Z'}],bookings:[{id:'book_demo',tenant_id:'tenant_demo',lead_id:'lead_demo_1',inventory_id:'VW-CAB-704',date:'2026-09-18',time:'15:00',seats:4,status:'CONFIRMED',reference:'QD-VW-CAB-704-1842',created_at:'2026-09-15T09:10:00.000Z'}],tours:[{id:'tour_demo',tenant_id:'tenant_demo',lead_id:'lead_demo_1',inventory_id:'VW-CAB-704',date:'2026-09-18',time:'15:00',mode:'in_person',status:'CONFIRMED',created_at:'2026-09-15T09:11:00.000Z'}],activities:[{id:'act_1',tenant_id:'tenant_demo',lead_id:'lead_demo_1',type:'WHATSAPP',title:'Lead replied on WhatsApp',body:'Needs 8 seats on Golf Course Road, budget up to ₹15,000.',created_at:'2026-09-15T09:00:00.000Z'},{id:'act_2',tenant_id:'tenant_demo',lead_id:'lead_demo_1',type:'AI',title:'AI qualification completed',body:'8 seats · Golf Course Road · ₹15,000 · furnished · 12 months.',created_at:'2026-09-15T09:04:00.000Z'},{id:'act_3',tenant_id:'tenant_demo',lead_id:'lead_demo_1',type:'CALL',title:'Follow-up call task created',body:'Call now — warm lead SLA active.',created_at:'2026-09-15T09:05:00.000Z'}],handoffs:[{id:'handoff_demo',tenant_id:'tenant_demo',lead_id:'lead_demo_1',owner:'Priya Nair',reason:'High-fit warm lead',status:'OPEN',created_at:'2026-09-15T09:12:00.000Z'}],cadence:[{id:'c1',offset:'T+2h',channel:'WhatsApp',action:'Send value follow-up',enabled:true},{id:'c2',offset:'T+1d',channel:'Call',action:'Create follow-up task',enabled:true},{id:'c3',offset:'T+2d',channel:'Email',action:'Send alternatives',enabled:true},{id:'c4',offset:'T+4d',channel:'WhatsApp',action:'Offer tour',enabled:true},{id:'c5',offset:'T+7d',channel:'Call',action:'Final call',enabled:true},{id:'c6',offset:'T+14d',channel:'WhatsApp',action:'Move to nurture',enabled:true}]};}
function load(){let d;if(!fs.existsSync(dbFile)){d=seed()}else{try{d=JSON.parse(fs.readFileSync(dbFile,'utf8'))}catch{d=seed()}}const base=seed();for(const k of ['tenants','users','inventory','leads','requirements','bookings','tours','handoffs','activities','cadence'])if(!Array.isArray(d[k]))d[k]=base[k];if(!d.tenants?.length)d.tenants=base.tenants;if(!d.inventory?.length)d.inventory=base.inventory;if(!d.leads?.length)d.leads=base.leads;if(!d.requirements?.length)d.requirements=base.requirements;if(!d.bookings?.length)d.bookings=base.bookings;if(!d.tours?.length)d.tours=base.tours;if(!d.handoffs?.length)d.handoffs=base.handoffs;if(!d.cadence?.length)d.cadence=base.cadence;if(!d.users?.length)d.users=base.users;if(!Array.isArray(d.activities))d.activities=base.activities;if(!Array.isArray(d.events))d.events=[];if(!Array.isArray(d.voice_sessions))d.voice_sessions=[];for(const l of d.leads)if(!Array.isArray(l.messages))l.messages=[];save(d);return d}
function save(db){fs.mkdirSync(path.dirname(dbFile),{recursive:true});fs.writeFileSync(dbFile,JSON.stringify(db,null,2))}
function id(prefix=''){return prefix+crypto.randomUUID().replaceAll('-','').slice(0,12)}
function send(res,status,payload){res.writeHead(status,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS'});res.end(JSON.stringify(payload))}
async function body(req){let s='';for await(const c of req)s+=c;return s?JSON.parse(s):{}}
function scoped(a){return a.filter(x=>x.tenant_id===TENANT)}
function requirement(db,leadId){return db.requirements.find(x=>x.lead_id===leadId)||{}}
function score(unit,r){if(!unit.active||unit.available<=0)return -Infinity;let s=0;if(r.product_type){s+=unit.product_type===r.product_type?35:-25}if(r.market){s+=unit.market.toLowerCase()===String(r.market).toLowerCase()?25:-10}if(r.seats){const d=unit.seats-Number(r.seats);s+=d>=0?25-Math.min(d*2,15):-Math.min(Math.abs(d)*5,30)}if(r.budget){s+=unit.price<=Number(r.budget)?15:-Math.min(((unit.price-Number(r.budget))/Math.max(Number(r.budget),1))*30,25)}return Math.round(s)}
// A match must clear a minimum viable-fit bar to count as a real recommendation
// (BUILD_SPEC §6: "hard filter + soft rank"). Without this, a unit with a wildly
// wrong product/seats/budget fit still showed up just because it wasn't literally
// sold out — which meant "no real inventory for this requirement" was invisible to
// the decision engine and never became a demand-gap escalation.
const MIN_MATCH_SCORE=0;
function matches(db,lead){const r=requirement(db,lead.id);return scoped(db.inventory).map(x=>({...x,score:score(x,r)})).filter(x=>x.score>MIN_MATCH_SCORE).sort((a,b)=>b.score-a.score).slice(0,3)}
function teamScoped(db){return scoped(db.users||[]).filter(u=>u.active!==false)}
function extractSlots(db,text,base={}){
  // Thin wrapper kept for backward compatibility — the real extraction logic lives
  // in the pure, unit-tested nia-brain module (numeric ranges, furnishing, parking,
  // urgency, decision-maker signals, budget-flexible detection, etc).
  const markets=[...new Set(scoped(db.inventory).map(x=>x.market).filter(Boolean))];
  return brain.extractRequirement(text,base,markets);
}
function agentReply(db,lead,r,ms,decision,objections=[],competitor=null){
  // The reply is composed around the decision engine's chosen action, never the
  // other way around — the model doesn't decide what to say and then invent a
  // reason; the grounded action decides what gets said.
  if(competitor)return `Thanks for flagging that — I hear you on the ${competitor.name} comparison${competitor.quoted_price?` at ₹${competitor.quoted_price.toLocaleString('en-IN')}`:''}. Let me pull together what makes sense on our side and a rep will confirm the specifics with you shortly.`;
  if(objections.length && !competitor)return `Got it — noted on the ${objections[0].toLowerCase()}. Let me check what else might work for you.`;
  switch(decision?.action){
    case 'ASK_QUESTION': return `Thanks for sharing that. Could you also tell me your ${String(decision.ask_for||'requirement').replaceAll('_',' ')}?`;
    case 'SEND_SHORTLIST': return ms.length?`I found ${ms.length} grounded option${ms.length>1?'s':''} that fit your requirement — sending you the shortlist now.`:`I have your full requirement noted. Let me check current availability and come back to you shortly.`;
    case 'SCHEDULE_TOUR': return ms.length?`Happy to set up a tour of ${ms[0].unit} — I'll confirm the next available slot and send you the details.`:`I'd like to set up a tour, but let me confirm availability first and come back to you.`;
    case 'BOOK': return `Great — I'm confirming that booking against live availability now and will send the reference shortly.`;
    case 'HANDOFF': return `Thanks — I'm connecting you with a member of our team who can take this forward.`;
    case 'ESCALATE': return `I don't have an exact match in our current inventory for this yet — I'm flagging it to the team so we can find something that works.`;
    case 'MARK_LOST': return `Understood, thanks for letting us know. We're here if things change.`;
    default: return `Noted, thank you.`;
  }
}
function assignOwner(db,lead){
  const team=teamScoped(db); if(!team.length)return null;
  const r=requirement(db,lead.id);
  const loadOf=u=>(db.handoffs||[]).filter(h=>h.owner===u.name&&h.status==='OPEN').length;
  const inMarket=r.market?team.filter(u=>(u.markets||[]).some(m=>m.toLowerCase()===String(r.market).toLowerCase())):[];
  const pool=inMarket.length?inMarket:team;
  return pool.slice().sort((a,b)=>loadOf(a)-loadOf(b))[0]?.name||null;
}
function analytics(db){const leads=scoped(db.leads), warm=leads.filter(x=>x.stage==='WARM').length, withMatch=leads.filter(x=>matches(db,x).length).length;return {conversion_rate:leads.length?Math.round(warm/leads.length*100):0,avg_score:leads.length?Math.round(leads.reduce((s,x)=>s+(x.score||0),0)/leads.length):0,inventory_fit_rate:leads.length?Math.round(withMatch/leads.length*100):0,leads:leads.length,warm,available:scoped(db.inventory).reduce((s,x)=>s+Number(x.available||0),0)}}

function automationConfig(db){
  db.automation = db.automation || {enabled:true, liveQualify:true, autoQualify:true, autoMatch:true, autoShortlist:true, autoNurture:true, autoHandover:true, voiceEnabled:true};
  return db.automation;
}
function addActivity(db, leadId, type, title, body=''){
  const x={id:id('act_'),tenant_id:TENANT,lead_id:leadId,type,title,body,created_at:new Date().toISOString()};
  db.activities=db.activities||[]; db.activities.push(x);
  const l=db.leads.find(z=>z.id===leadId && z.tenant_id===TENANT); if(l) l.updated_at=x.created_at;
  // P3: fan the same write out to any open SSE subscriber. The activity is already
  // persisted at this point, so the stream is a notification of committed state,
  // never a second source of truth that could drift from the database.
  realtime.publish('activity',{lead_id:leadId,company:l?.company||null,activity:x});
  return x;
}
// Structured, timestamped event log — separate from the human-readable `activities`
// feed. This is what makes every autonomous decision traceable after the fact
// (master prompt §21/§33: "why did NIA send this message / recommend this / hand
// this off"), instead of only ever knowing the current state.
function addEvent(db, leadId, type, payload={}){
  const x={id:id('evt_'),tenant_id:TENANT,lead_id:leadId,event_type:type,payload,source:'nia',created_at:new Date().toISOString()};
  db.events=db.events||[]; db.events.push(x);
  const l=db.leads.find(z=>z.id===leadId && z.tenant_id===TENANT);
  realtime.publish('event',{lead_id:leadId,company:l?.company||null,event:x});
  return x;
}
// Emitted whenever a lead's own row changes (stage, score, next action) so the
// inbox and dashboard can repaint that row without re-fetching every collection.
function publishLead(lead){
  if(!lead)return;
  realtime.publish('lead',{lead_id:lead.id,company:lead.company,lead:{id:lead.id,company:lead.company,contact:lead.contact,stage:lead.stage,score:lead.score,channel:lead.channel,next_action:lead.next_action||null,next_action_priority:lead.next_action_priority||null,updated_at:lead.updated_at}});
}
function engagementFor(lead, requirement){
  return {repliesReceived:Number(lead.replies_count||0), shortlistOpened:!!lead.shortlist_opened, lastIntent:lead.last_intent||'NEW_INQUIRY'};
}
// Serving rules (BUILD_SPEC §5): private cabins / managed suites, or anything above
// 10 seats, must go through a KAM rather than self-serve booking.
function needsKamForBooking(r){
  return ['private_office','managed_suite'].includes(r.product_type) || Number(r.seats||0)>10;
}
// The NIA decision loop (BUILD_SPEC §22 / master prompt §5-6): read state, extract
// what changed, recompute score, ask the decision engine for ONE next-best-action,
// then execute *that* action if the automation gates authorize it. This deliberately
// does not cascade through every stage in one call — a lead earns its way to WARM
// through real signal (a complete requirement, a reply, an objection, high intent),
// not because a button was pressed. See master prompt §12 / §34 ("do not fake
// automation" / "do not blindly execute every possible action").
function runAutomation(db, lead, opts={}){
  const cfg=automationConfig(db), r=requirement(db,lead.id), ms=matches(db,lead);
  const objections=r.objections||[], competitor=r.competitor||null;
  const engagement=engagementFor(lead,r);
  const hasOpenHandoff=(db.handoffs||[]).some(h=>h.lead_id===lead.id&&h.status==='OPEN');

  const {score,breakdown}=brain.computeLeadScore({requirement:r,matches:ms,engagement,weights:cfg.scoringWeights});
  lead.score=score; lead.score_breakdown=breakdown;
  addEvent(db,lead.id,'SCORE_UPDATED',{score,breakdown});

  const decision=brain.nextBestAction({requirement:r,matches:ms,objections,competitor,lastIntent:engagement.lastIntent,leadScore:score,hasOpenHandoff,seatsAboveSelfServe:needsKamForBooking(r)});
  lead.next_action=decision.action; lead.next_action_reason=decision.reason; lead.next_action_priority=decision.priority; lead.next_action_requires_human=decision.requires_human;
  addEvent(db,lead.id,'DECISION',decision);

  const actions=[]; const gateOn=cfg.enabled!==false;
  const doHandoff=(reason)=>{
    if(!cfg.autoHandover||hasOpenHandoff)return;
    const owner=assignOwner(db,lead);
    db.handoffs=db.handoffs||[];
    const h={id:id('handoff_'),tenant_id:TENANT,lead_id:lead.id,owner,reason,status:'OPEN',sla_minutes:brain.slaMinutesForScore(score),created_at:new Date().toISOString()};
    db.handoffs.push(h);
    addActivity(db,lead.id,'HANDOFF','Human handoff created',owner?`Routed to ${owner} for follow-up. SLA: ${h.sla_minutes} min.`:`Lead is ready for a rep to follow up. SLA: ${h.sla_minutes} min.`);
    addEvent(db,lead.id,'HANDOFF_CREATED',{owner,sla_minutes:h.sla_minutes,reason});
    lead.stage='WARM'; actions.push('handoff');
  };

  if(gateOn) switch(decision.action){
    case 'ASK_QUESTION':
      if(lead.stage==='CAPTURED')lead.stage='QUALIFYING';
      addActivity(db,lead.id,'AI','Lead qualification in progress',decision.reason);
      actions.push('qualified'); break;
    case 'SEND_SHORTLIST':
      if(cfg.autoShortlist && ms.length){
        lead.stage=lead.stage==='CAPTURED'||lead.stage==='QUALIFYING'?'MATCHED':lead.stage;
        addEvent(db,lead.id,'INVENTORY_MATCHED',{count:ms.length});
        addEvent(db,lead.id,'SHORTLIST_GENERATED',{ids:ms.slice(0,3).map(m=>m.id)});
        lead.stage='SHORTLIST';
        addActivity(db,lead.id,'WHATSAPP','Shortlist sent',`Sent ${Math.min(3,ms.length)} grounded option${ms.length>1?'s':''} to the lead.`);
        addEvent(db,lead.id,'SHORTLIST_SENT',{count:Math.min(3,ms.length)});
        actions.push('shortlist');
      } break;
    case 'HANDLE_OBJECTION':
      addActivity(db,lead.id,'AI','Objection handled',decision.reason);
      addEvent(db,lead.id,'OBJECTION_DETECTED',{objections,competitor});
      actions.push('objection_handled'); break;
    case 'SCHEDULE_TOUR': {
      const target=ms[0];
      if(target && Number(target.available)>0){
        const slot=nextTourSlot();
        const tour={id:id('tour_'),tenant_id:TENANT,lead_id:lead.id,inventory_id:target.id,date:slot.date,time:slot.time,mode:'in_person',status:'CONFIRMED',created_at:new Date().toISOString()};
        db.tours.push(tour);
        addActivity(db,lead.id,'AI','Tour scheduled',`${target.unit} on ${slot.date} at ${slot.time}, confirmed against live availability.`);
        addEvent(db,lead.id,'TOUR_BOOKED',{tour_id:tour.id,inventory_id:target.id});
        lead.stage='WARM'; actions.push('tour_booked');
      } else {
        addActivity(db,lead.id,'AI','Tour requested — no availability',`Lead asked for a tour but ${target?target.unit:'the matched unit'} has no open slots; routing to a rep.`);
        addEvent(db,lead.id,'TOUR_REQUESTED',{available:false});
        doHandoff('Tour requested but no live availability — needs manual coordination.');
      } break;
    }
    case 'BOOK': {
      const target=ms[0];
      if(target && Number(target.available)>0 && r.seats){
        target.available-=1;
        const booking={id:id('book_'),tenant_id:TENANT,lead_id:lead.id,inventory_id:target.id,date:r.move_in_date&&r.move_in_date!=='Immediate'?r.move_in_date:new Date().toISOString().slice(0,10),time:'10:00',seats:Number(r.seats),status:'CONFIRMED',reference:`QD-${target.id}-${Math.floor(1000+Math.random()*9000)}`,created_at:new Date().toISOString()};
        db.bookings.push(booking);
        addActivity(db,lead.id,'AI','Booking confirmed',`${target.unit} booked for ${r.seats} seats. Reference ${booking.reference}.`);
        addEvent(db,lead.id,'BOOKING_CONFIRMED',{booking_id:booking.id});
        lead.stage='WARM'; actions.push('booked');
      } else { addEvent(db,lead.id,'BOOKING_REQUESTED',{fulfilled:false}); doHandoff('Booking intent detected but requires KAM confirmation.'); }
      break;
    }
    case 'HANDOFF':
    case 'ESCALATE':
      doHandoff(decision.reason); break;
    case 'MARK_LOST':
      lead.stage='CLOSED'; lead.outcome='LOST';
      addActivity(db,lead.id,'AI','Lead marked lost',decision.reason);
      addEvent(db,lead.id,'LEAD_LOST',{reason:decision.reason});
      actions.push('lost'); break;
    case 'FOLLOW_UP':
    default: {
      const cadenceStep=brain.nextFollowUpDelay({repliesReceived:engagement.repliesReceived,hoursSinceLastReply:(Date.now()-new Date(lead.updated_at||lead.created_at).getTime())/3.6e6,lastIntent:engagement.lastIntent});
      if(cfg.autoNurture && lead.stage!=='WARM' && lead.stage!=='CLOSED') lead.stage=lead.stage==='SHORTLIST'||lead.stage==='MATCHED'?'NURTURING':lead.stage;
      addEvent(db,lead.id,'FOLLOWUP_SCHEDULED',cadenceStep);
      actions.push('follow_up_scheduled'); break;
    }
  }

  lead.updated_at=new Date().toISOString();
  publishLead(lead);
  return {actions,matches:ms,decision};
}
function nextTourSlot(){
  const d=new Date(); d.setDate(d.getDate()+1);
  return {date:d.toISOString().slice(0,10),time:'15:00'};
}
function demandGap(db){
  const reqs=(db.requirements||[]).filter(r=>{const l=db.leads.find(x=>x.id===r.lead_id);return l&&l.tenant_id===TENANT}); const inv=scoped(db.inventory||[]);
  const buckets={};
  for(const r of reqs){const key=`${r.market||'Unknown'}|${r.product_type||'Any'}|${r.seats||0}`;buckets[key]=(buckets[key]||0)+1;}
  return Object.entries(buckets).map(([key,demand])=>{const [market,product,seats]=key.split('|');const available=inv.filter(i=>(!market||i.market===market)&&(!product||i.product_type===product)&&Number(i.seats||0)>=Number(seats||0)).reduce((s,i)=>s+Number(i.available||0),0);return {market,product_type:product,seats:Number(seats),demand,available,gap:Math.max(0,demand-available),status:available>=demand?'covered':'gap'};}).sort((a,b)=>b.gap-a.gap||b.demand-a.demand);
}
const server=http.createServer(async(req,res)=>{try{if(req.method==='OPTIONS')return send(res,204,{});const u=new URL(req.url,`http://${req.headers.host}`),p=u.pathname,db=load();
 if(p==='/api/health')return send(res,200,{ok:true,service:'deskline-api',tenant:TENANT,storage:'json-fallback',productionDatabase:'PostgreSQL schema included'});
 if(p==='/api/tenant')return send(res,200,db.tenants.find(x=>x.id===TENANT)||null);
 if(p==='/api/inventory'&&req.method==='GET')return send(res,200,scoped(db.inventory));
 if(p==='/api/inventory'&&req.method==='POST'){const b=await body(req);const x={id:id('inv_'),tenant_id:TENANT,centre:b.centre,unit:b.unit||b.unit_name,product_type:b.product_type||'private_office',market:b.market,seats:Number(b.seats),price:Number(b.price),floor_price:Number(b.floor_price??b.price),available:Number(b.available??0),available_from:b.available_from||null,amenities:Array.isArray(b.amenities)?b.amenities:[],active:b.active!==false};if(!x.centre||!x.unit||!x.market||!x.seats||!x.price)return send(res,400,{error:'centre, unit, market, seats and price are required'});db.inventory.push(x);save(db);return send(res,201,x)}
 if(p==='/api/inventory/import'&&req.method==='POST'){const b=await body(req);const rows=Array.isArray(b.rows)?b.rows:[];const created=rows.map(r=>({id:id('inv_'),tenant_id:TENANT,centre:r.centre,unit:r.unit||r.unit_name,product_type:r.product_type||'private_office',market:r.market,seats:Number(r.seats),price:Number(r.price),floor_price:Number(r.floor_price||r.price),available:Number(r.available||0),available_from:r.available_from||null,amenities:String(r.amenities||'').split('|').flatMap(x=>x.split(';')).map(x=>x.trim()).filter(Boolean),active:String(r.active??'true').toLowerCase()!=='false'})).filter(x=>x.centre&&x.unit&&x.market&&x.seats&&x.price);db.inventory.push(...created);save(db);return send(res,201,{created:created.length,items:created})}
 if(p==='/api/leads'&&req.method==='GET')return send(res,200,scoped(db.leads).sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at)));
 if(p==='/api/leads'&&req.method==='POST'){const b=await body(req),now=new Date().toISOString();if(!b.company)return send(res,400,{error:'company is required'});const l={id:id('lead_'),tenant_id:TENANT,company:b.company,contact:b.contact||'',source:b.source||b.channel||'web',channel:b.channel||'web',stage:'CAPTURED',score:null,created_at:now,updated_at:now};const r={id:id('req_'),lead_id:l.id,product_type:b.product_type||null,seats:b.seats?Number(b.seats):null,market:b.market||null,budget:b.budget?Number(b.budget):null,move_in_date:b.move_in_date||null,tenure:b.tenure||null,fit_out:b.fit_out||null,notes:b.notes||'',confidence:{},version:1,updated_at:now};db.leads.push(l);db.requirements.push(r);db.activities=db.activities||[];addActivity(db,l.id,'SYSTEM','Lead entered CRM','Lead captured in Deskline.');runAutomation(db,l);save(db);return send(res,201,{lead:l,requirement:r,automation:automationConfig(db),matches:matches(db,l)})}
 const lm=p.match(/^\/api\/leads\/([^/]+)$/);if(lm&&req.method==='PUT'){const l=db.leads.find(x=>x.id===lm[1]&&x.tenant_id===TENANT);if(!l)return send(res,404,{error:'lead not found'});const b=await body(req);Object.assign(l,b,{updated_at:new Date().toISOString()});if(b.requirement){const r=requirement(db,l.id);Object.assign(r,b.requirement,{version:(r.version||0)+1,updated_at:new Date().toISOString()})}save(db);return send(res,200,l)}
 const mm=p.match(/^\/api\/leads\/([^/]+)\/matches$/);if(mm){const l=db.leads.find(x=>x.id===mm[1]&&x.tenant_id===TENANT);if(!l)return send(res,404,{error:'lead not found'});return send(res,200,{lead:l,requirement:requirement(db,l.id),matches:matches(db,l)})}
 if(p==='/api/bookings'&&req.method==='GET')return send(res,200,scoped(db.bookings));
 if(p==='/api/bookings'&&req.method==='POST'){const b=await body(req),l=db.leads.find(x=>x.id===b.lead_id&&x.tenant_id===TENANT),inv=db.inventory.find(x=>x.id===b.inventory_id&&x.tenant_id===TENANT);if(!l||!inv)return send(res,400,{error:'lead or inventory not found'});if(inv.available<Number(b.seats||1))return send(res,409,{error:'not enough inventory available'});inv.available-=Number(b.seats||1);const x={id:id('book_'),tenant_id:TENANT,lead_id:l.id,inventory_id:inv.id,date:b.date,time:b.time,seats:Number(b.seats||1),status:b.status||'CONFIRMED',reference:`QD-${inv.id}-${Math.floor(1000+Math.random()*9000)}`,created_at:new Date().toISOString()};db.bookings.push(x);save(db);return send(res,201,x)}
 const bm=p.match(/^\/api\/bookings\/([^/]+)$/);if(bm&&req.method==='PUT'){const x=db.bookings.find(x=>x.id===bm[1]&&x.tenant_id===TENANT);if(!x)return send(res,404,{error:'booking not found'});Object.assign(x,await body(req));save(db);return send(res,200,x)}
 if(p==='/api/tours'&&req.method==='GET')return send(res,200,scoped(db.tours));
 if(p==='/api/tours'&&req.method==='POST'){const b=await body(req);const x={id:id('tour_'),tenant_id:TENANT,lead_id:b.lead_id,inventory_id:b.inventory_id,date:b.date,time:b.time,mode:b.mode||'in_person',status:'CONFIRMED',created_at:new Date().toISOString()};db.tours.push(x);save(db);return send(res,201,x)}
 const tm=p.match(/^\/api\/tours\/([^/]+)$/);if(tm&&req.method==='PUT'){const x=db.tours.find(x=>x.id===tm[1]&&x.tenant_id===TENANT);if(!x)return send(res,404,{error:'tour not found'});Object.assign(x,await body(req));save(db);return send(res,200,x)}
 if(p==='/api/handoffs'&&req.method==='GET')return send(res,200,scoped(db.handoffs));
 if(p==='/api/handoffs'&&req.method==='POST'){const b=await body(req);const x={id:id('handoff_'),tenant_id:TENANT,lead_id:b.lead_id,owner:b.owner||null,reason:b.reason||'Manual handoff',status:'OPEN',created_at:new Date().toISOString()};db.handoffs.push(x);save(db);return send(res,201,x)}
 const hm=p.match(/^\/api\/handoffs\/([^/]+)$/);if(hm&&req.method==='PUT'){const x=db.handoffs.find(x=>x.id===hm[1]&&x.tenant_id===TENANT);if(!x)return send(res,404,{error:'handoff not found'});Object.assign(x,await body(req));save(db);return send(res,200,x)}
 if(p==='/api/activities'&&req.method==='POST'){const b=await body(req);const l=db.leads.find(x=>x.id===b.lead_id&&x.tenant_id===TENANT);if(!l)return send(res,404,{error:'lead not found'});const x={id:id('act_'),tenant_id:TENANT,lead_id:l.id,type:b.type||'NOTE',title:b.title||'Activity logged',body:b.body||'',created_at:new Date().toISOString()};db.activities.push(x);l.updated_at=x.created_at;save(db);return send(res,201,x)}
 const am=p.match(/^\/api\/leads\/([^/]+)\/activity$/);if(am&&req.method==='GET'){const l=db.leads.find(x=>x.id===am[1]&&x.tenant_id===TENANT);if(!l)return send(res,404,{error:'lead not found'});return send(res,200,db.activities.filter(x=>x.lead_id===l.id&&x.tenant_id===TENANT).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)))}
 const sm=p.match(/^\/api\/leads\/([^/]+)\/ai-summary$/);if(sm&&req.method==='POST'){const l=db.leads.find(x=>x.id===sm[1]&&x.tenant_id===TENANT);if(!l)return send(res,404,{error:'lead not found'});const r=requirement(db,l.id);const ms=matches(db,l);const missing=[];for(const k of ['product_type','seats','market','budget','move_in_date','tenure'])if(r[k]==null||r[k]==='')missing.push(k.replaceAll('_',' '));const next=l.stage==='WARM'?'Call now':missing.length?`Ask for ${missing[0]}`:ms.length?'Share shortlist':'Find alternative inventory';const summary=`${l.company} is a ${l.stage.toLowerCase()} lead with a score of ${l.score??'unscored'}. Requirement: ${r.seats||'—'} seats${r.market?' in '+r.market:''}${r.budget?' up to ₹'+Number(r.budget).toLocaleString('en-IN'):''}. ${ms.length} grounded inventory matches are available.`;return send(res,200,{summary,next_action:next,missing,fit_score:l.score??0,match_count:ms.length})}

 const decisionMatch=p.match(/^\/api\/leads\/([^/]+)\/decision$/);
 if(decisionMatch&&req.method==='GET'){
   const l=db.leads.find(x=>x.id===decisionMatch[1]&&x.tenant_id===TENANT);if(!l)return send(res,404,{error:'lead not found'});
   const r=requirement(db,l.id),ms=matches(db,l),engagement=engagementFor(l,r);
   const hasOpenHandoff=(db.handoffs||[]).some(h=>h.lead_id===l.id&&h.status==='OPEN');
   const decision=brain.nextBestAction({requirement:r,matches:ms,objections:r.objections||[],competitor:r.competitor||null,lastIntent:engagement.lastIntent,leadScore:l.score||0,hasOpenHandoff,seatsAboveSelfServe:needsKamForBooking(r)});
   return send(res,200,{lead_id:l.id,decision,score_breakdown:l.score_breakdown||null,engagement});
 }
 const briefMatch=p.match(/^\/api\/leads\/([^/]+)\/brief$/);
 if(briefMatch&&req.method==='GET'){
   const l=db.leads.find(x=>x.id===briefMatch[1]&&x.tenant_id===TENANT);if(!l)return send(res,404,{error:'lead not found'});
   const r=requirement(db,l.id),ms=matches(db,l),engagement=engagementFor(l,r);
   return send(res,200,brain.buildBriefing({lead:l,requirement:r,matches:ms,objections:r.objections||[],competitor:r.competitor||null,engagement}));
 }
 const eventsForLead=p.match(/^\/api\/leads\/([^/]+)\/events$/);
 if(eventsForLead&&req.method==='GET'){
   const l=db.leads.find(x=>x.id===eventsForLead[1]&&x.tenant_id===TENANT);if(!l)return send(res,404,{error:'lead not found'});
   return send(res,200,(db.events||[]).filter(x=>x.lead_id===l.id&&x.tenant_id===TENANT).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)));
 }
 if(p==='/api/events'&&req.method==='GET')return send(res,200,(db.events||[]).filter(x=>x.tenant_id===TENANT).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,200));
 if(p==='/api/sla/breaches'&&req.method==='GET'){
   const open=(db.handoffs||[]).filter(h=>h.tenant_id===TENANT&&h.status==='OPEN');
   const breaches=open.filter(h=>{const l=db.leads.find(x=>x.id===h.lead_id);return brain.isSlaBreached(h.created_at,l?.score||0)});
   for(const h of breaches){if(!h.sla_breached){h.sla_breached=true;addEvent(db,h.lead_id,'SLA_BREACHED',{handoff_id:h.id});addActivity(db,h.lead_id,'AI','SLA breached',`Handoff to ${h.owner||'a rep'} has exceeded its response SLA.`)}}
   if(breaches.length)save(db);
   return send(res,200,breaches);
 }
 if(p==='/api/automation'&&req.method==='GET')return send(res,200,automationConfig(db));
 if(p==='/api/automation'&&req.method==='PUT'){const b=await body(req);db.automation={...automationConfig(db),...b};save(db);return send(res,200,db.automation)}
 const aut=p.match(/^\/api\/leads\/([^/]+)\/automate$/);if(aut&&req.method==='POST'){const l=db.leads.find(x=>x.id===aut[1]&&x.tenant_id===TENANT);if(!l)return send(res,404,{error:'lead not found'});const result=runAutomation(db,l,{force:true});save(db);return send(res,200,{lead:l,...result})}
 const shortlist=p.match(/^\/api\/leads\/([^/]+)\/shortlist$/);if(shortlist&&req.method==='POST'){const l=db.leads.find(x=>x.id===shortlist[1]&&x.tenant_id===TENANT);if(!l)return send(res,404,{error:'lead not found'});const ms=matches(db,l);if(!ms.length)return send(res,409,{error:'No grounded inventory matches'});l.stage='SHORTLIST';l.updated_at=new Date().toISOString();addActivity(db,l.id,'WHATSAPP','Shortlist sent',`Sent ${Math.min(3,ms.length)} grounded inventory option${ms.length>1?'s':''}.`);save(db);return send(res,200,{lead:l,matches:ms.slice(0,3),sent:true})}
 const warm=p.match(/^\/api\/leads\/([^/]+)\/warm$/);if(warm&&req.method==='POST'){const l=db.leads.find(x=>x.id===warm[1]&&x.tenant_id===TENANT);if(!l)return send(res,404,{error:'lead not found'});l.stage='WARM';l.score=Math.max(60,Number(l.score||0));addActivity(db,l.id,'AI','Lead warming started','Follow-up and human-ready actions activated.');save(db);return send(res,200,{lead:l})}
 const hand=p.match(/^\/api\/leads\/([^/]+)\/handoff$/);if(hand&&req.method==='POST'){const l=db.leads.find(x=>x.id===hand[1]&&x.tenant_id===TENANT);if(!l)return send(res,404,{error:'lead not found'});db.handoffs=db.handoffs||[];let h=db.handoffs.find(x=>x.lead_id===l.id&&x.status==='OPEN');if(!h){const owner=assignOwner(db,l);h={id:id('handoff_'),tenant_id:TENANT,lead_id:l.id,owner,reason:'Human handoff requested from the lead inbox',status:'OPEN',created_at:new Date().toISOString()};db.handoffs.push(h);addActivity(db,l.id,'HANDOFF','Human handoff created',owner?`Routed to ${owner} for follow-up.`:'Lead moved to the handoff queue.');}l.stage='WARM';save(db);return send(res,201,h)}

 if(p==='/api/team'&&req.method==='GET')return send(res,200,teamScoped(db).map(u=>({...u,load:(db.handoffs||[]).filter(h=>h.owner===u.name&&h.status==='OPEN').length})));
 if(p==='/api/team'&&req.method==='POST'){const b=await body(req);if(!b.name)return send(res,400,{error:'name is required'});const x={id:id('user_'),tenant_id:TENANT,name:b.name,email:b.email||'',phone:b.phone||'',role:b.role||'Sales Rep',markets:Array.isArray(b.markets)?b.markets:String(b.markets||'').split(/[,;]/).map(s=>s.trim()).filter(Boolean),capacity:Number(b.capacity||10),active:b.active!==false};db.users=db.users||[];db.users.push(x);save(db);return send(res,201,x)}
 if(p==='/api/team/import'&&req.method==='POST'){const b=await body(req);const rows=Array.isArray(b.rows)?b.rows:[];const created=rows.map(r=>{const name=r.name||r.Name||r.full_name||r['Full Name'];if(!name)return null;const markets=r.markets||r.Markets||r.market||r.Market||'';return {id:id('user_'),tenant_id:TENANT,name,email:r.email||r.Email||'',phone:r.phone||r.Phone||'',role:r.role||r.Role||'Sales Rep',markets:String(markets).split(/[,;|]/).map(s=>s.trim()).filter(Boolean),capacity:Number(r.capacity||r.Capacity||10),active:String(r.active??r.Active??'true').toLowerCase()!=='false'}}).filter(Boolean);db.users=db.users||[];db.users.push(...created);save(db);return send(res,201,{created:created.length,items:created})}
 const teamUpdate=p.match(/^\/api\/team\/([^/]+)$/);if(teamUpdate&&req.method==='PUT'){const u=(db.users||[]).find(x=>x.id===teamUpdate[1]&&x.tenant_id===TENANT);if(!u)return send(res,404,{error:'team member not found'});const b=await body(req);Object.assign(u,b);save(db);return send(res,200,u)}
 const teamDelete=p.match(/^\/api\/team\/([^/]+)$/);if(teamDelete&&req.method==='DELETE'){const before=(db.users||[]).length;db.users=(db.users||[]).filter(x=>!(x.id===teamDelete[1]&&x.tenant_id===TENANT));save(db);return send(res,200,{deleted:before-(db.users||[]).length})}

 const msgs=p.match(/^\/api\/leads\/([^/]+)\/messages$/);
 if(msgs&&req.method==='GET'){const l=db.leads.find(x=>x.id===msgs[1]&&x.tenant_id===TENANT);if(!l)return send(res,404,{error:'lead not found'});return send(res,200,l.messages||[])}
 if(msgs&&req.method==='POST'){
   const l=db.leads.find(x=>x.id===msgs[1]&&x.tenant_id===TENANT);if(!l)return send(res,404,{error:'lead not found'});
   const b=await body(req);const text=String(b.text||'').trim();if(!text)return send(res,400,{error:'text is required'});
   const from=b.from==='agent'?'agent':'lead';const now=new Date().toISOString();
   l.messages=l.messages||[];l.messages.push({id:id('msg_'),from,text,at:now});
   if(from==='lead'){
     addActivity(db,l.id,'WHATSAPP','Lead message received',text);
     addEvent(db,l.id,'MESSAGE_RECEIVED',{text});

     const r=requirement(db,l.id);
     const updated=extractSlots(db,text,r);
     const newObjections=brain.extractObjections(text);
     const newCompetitor=brain.extractCompetitor(text);
     const objections=[...new Set([...(r.objections||[]),...newObjections])];
     Object.assign(r,updated,{objections,competitor:newCompetitor||r.competitor||null,version:(r.version||0)+1,updated_at:now});
     if(newObjections.length)addEvent(db,l.id,'OBJECTION_DETECTED',{objections:newObjections});
     if(newCompetitor)addEvent(db,l.id,'REQUIREMENT_UPDATED',{competitor:newCompetitor});

     const {intent,confidence}=brain.detectIntent(text);
     l.last_intent=intent; l.last_intent_confidence=confidence;
     l.replies_count=Number(l.replies_count||0)+1;
     addEvent(db,l.id,'REQUIREMENT_UPDATED',{intent,confidence,slots:updated});

     const result=runAutomation(db,l,{});
     const ms=result.matches;
     const decision=result.decision;
     const replyText=agentReply(db,l,requirement(db,l.id),ms,decision,objections,newCompetitor);
     l.messages.push({id:id('msg_'),from:'agent',text:replyText,at:new Date().toISOString()});
     addEvent(db,l.id,'MESSAGE_SENT',{text:replyText});
   }
   l.updated_at=new Date().toISOString();save(db);
   return send(res,201,{messages:l.messages,lead:l,requirement:requirement(db,l.id),matches:matches(db,l),decision:l.next_action?{action:l.next_action,reason:l.next_action_reason,priority:l.next_action_priority,requires_human:l.next_action_requires_human}:null});
 }

 // -------------------------------------------------------------------------
 // P3 — real-time activity stream (Server-Sent Events)
 // -------------------------------------------------------------------------
 // `/api/stream` is the tenant-wide feed; `/api/leads/:id/stream` is the same
 // feed scoped to one lead (used by the lead drawer). Both replay anything missed
 // via `Last-Event-ID`, so a reconnecting tab catches up instead of silently
 // skipping the decisions NIA took while it was disconnected.
 if(p==='/api/stream'&&req.method==='GET'){
   realtime.subscribe(req,res,{lastEventId:req.headers['last-event-id']||u.searchParams.get('last_event_id')});
   return;
 }
 const leadStream=p.match(/^\/api\/leads\/([^/]+)\/stream$/);
 if(leadStream&&req.method==='GET'){
   const l=db.leads.find(x=>x.id===leadStream[1]&&x.tenant_id===TENANT);
   if(!l)return send(res,404,{error:'lead not found'});
   realtime.subscribe(req,res,{leadId:l.id,lastEventId:req.headers['last-event-id']||u.searchParams.get('last_event_id')});
   return;
 }
 if(p==='/api/stream/stats'&&req.method==='GET')return send(res,200,realtime.stats());

 // -------------------------------------------------------------------------
 // P4 — voice agent (BUILD_SPEC 8.1)
 // -------------------------------------------------------------------------
 if(p==='/api/voice/status'&&req.method==='GET')return send(res,200,voice.providerStatus());

 if(p==='/api/voice/sessions'&&req.method==='GET')
   return send(res,200,(db.voice_sessions||[]).filter(x=>x.tenant_id===TENANT).sort((a,b)=>new Date(b.started_at)-new Date(a.started_at)));

 // Steps 1-3: identify the caller, load tenant persona, personalise the greeting.
 // A caller we already know keeps their existing lead and requirement rather than
 // starting a duplicate record — that is what makes "I have your earlier
 // requirement in front of me" true rather than a scripted pleasantry.
 if(p==='/api/voice/sessions'&&req.method==='POST'){
   const b=await body(req),now=new Date().toISOString();
   const status=voice.providerStatus();
   const caller=String(b.caller||b.from||'').trim();
   let lead=b.lead_id?db.leads.find(x=>x.id===b.lead_id&&x.tenant_id===TENANT):null;
   if(!lead&&caller)lead=scoped(db.leads).find(x=>x.phone&&String(x.phone).replace(/\D/g,'').endsWith(caller.replace(/\D/g,'').slice(-10)));
   const known=Boolean(lead);
   if(!lead){
     if(!b.company&&!caller)return send(res,400,{error:'lead_id, company or caller is required'});
     lead={id:id('lead_'),tenant_id:TENANT,company:b.company||`Caller ${caller}`,contact:b.contact||'',phone:caller||'',source:'voice',channel:'call',stage:'CAPTURED',score:null,created_at:now,updated_at:now,messages:[]};
     db.leads.push(lead);
     db.requirements.push({id:id('req_'),lead_id:lead.id,product_type:null,seats:null,market:null,budget:null,move_in_date:null,tenure:null,fit_out:null,notes:'',confidence:{},version:1,updated_at:now});
     addActivity(db,lead.id,'SYSTEM','Lead entered CRM',`Created from an inbound voice call${caller?` (${caller})`:''}.`);
   }
   const tenantName=(db.tenants.find(x=>x.id===TENANT)||{}).name||'our team';
   const locale=b.locale||'en';
   const script=voice.openingScript({tenantName,agentName:b.agent_name||'Nia',contact:lead.contact,known,locale});
   const session={id:id('vs_'),tenant_id:TENANT,lead_id:lead.id,caller:caller||null,direction:b.direction==='outbound'?'outbound':'inbound',
     transport:status.transport,provider:status.provider,simulated:!status.configured,locale,agent_name:b.agent_name||'Nia',
     status:'AWAITING_CONSENT',consent:null,started_at:now,ended_at:null,turns:[],requirement_version_at_start:(requirement(db,lead.id).version||1),
     greeting:script.greeting,consent_line:script.consent};
   db.voice_sessions=db.voice_sessions||[];db.voice_sessions.push(session);
   addEvent(db,lead.id,'VOICE_CALL_STARTED',{session_id:session.id,direction:session.direction,transport:session.transport,known_caller:known});
   save(db);
   return send(res,201,{session,lead,requirement:requirement(db,lead.id),script,provider:status});
 }

 const vsTurn=p.match(/^\/api\/voice\/sessions\/([^/]+)\/turn$/);
 const vsConsent=p.match(/^\/api\/voice\/sessions\/([^/]+)\/consent$/);
 const vsEnd=p.match(/^\/api\/voice\/sessions\/([^/]+)\/end$/);
 const vsGet=p.match(/^\/api\/voice\/sessions\/([^/]+)$/);
 const findSession=(sid)=>(db.voice_sessions||[]).find(x=>x.id===sid&&x.tenant_id===TENANT);

 // Step 4 gate: consent is recorded before a single turn is accepted. Declining
 // ends the AI leg and routes to a human — it does not quietly keep listening.
 if(vsConsent&&req.method==='POST'){
   const s=findSession(vsConsent[1]);if(!s)return send(res,404,{error:'voice session not found'});
   const b=await body(req);const granted=b.granted!==false;
   s.consent={granted,at:new Date().toISOString()};
   s.status=granted?'LIVE':'ENDED';
   addActivity(db,s.lead_id,'CALL',granted?'Call recording consent given':'Call recording consent declined',granted?'Caller agreed to AI handling and recording.':'Caller declined — AI leg stopped and the call was routed to a person.');
   addEvent(db,s.lead_id,'VOICE_CONSENT',{session_id:s.id,granted});
   if(!granted){
     s.ended_at=new Date().toISOString();
     const lead=db.leads.find(x=>x.id===s.lead_id);
     db.handoffs=db.handoffs||[];
     if(lead&&!db.handoffs.some(h=>h.lead_id===lead.id&&h.status==='OPEN')){
       const owner=assignOwner(db,lead);
       db.handoffs.push({id:id('handoff_'),tenant_id:TENANT,lead_id:lead.id,owner,reason:'Caller declined AI handling on a voice call.',status:'OPEN',sla_minutes:brain.slaMinutesForScore(lead.score||0),created_at:new Date().toISOString()});
       addEvent(db,lead.id,'HANDOFF_CREATED',{owner,reason:'voice_consent_declined'});
       publishLead(lead);
     }
   }
   save(db);
   return send(res,200,{session:s,reply:granted?s.greeting:voice.declineLine(s.locale)});
 }

 // Steps 5-8: extract slots, pick the next question, search grounded inventory,
 // read back the top 3 and offer shortlist / tour / transfer.
 if(vsTurn&&req.method==='POST'){
   const s=findSession(vsTurn[1]);if(!s)return send(res,404,{error:'voice session not found'});
   if(s.status==='ENDED')return send(res,409,{error:'voice session has already ended'});
   if(!s.consent?.granted)return send(res,409,{error:'recording consent has not been given for this session'});
   const b=await body(req);const text=String(b.text||'').trim();
   if(!text)return send(res,400,{error:'text is required'});
   const startedAt=Date.now();
   const lead=db.leads.find(x=>x.id===s.lead_id&&x.tenant_id===TENANT);
   if(!lead)return send(res,404,{error:'lead not found'});

   const r=requirement(db,lead.id);
   const markets=[...new Set(scoped(db.inventory).map(x=>x.market).filter(Boolean))];
   const hasOpenHandoff=(db.handoffs||[]).some(h=>h.lead_id===lead.id&&h.status==='OPEN');

   // Understand first, then persist, then re-match, then speak. The order matters:
   // reading back inventory matched against the pre-turn requirement means the
   // agent can offer a unit the caller has just ruled out.
   const understanding=voice.extractTurn({text,requirement:r,markets});

   // Step 10: the requirement is versioned on every turn, so "what did the caller
   // actually say at minute three" stays answerable after the call.
   const objections=[...new Set([...(r.objections||[]),...(understanding.objections||[])])];
   Object.assign(r,understanding.slots,{objections,competitor:understanding.competitor||r.competitor||null,version:(r.version||0)+1,updated_at:new Date().toISOString()});
   lead.last_intent=understanding.intent;lead.last_intent_confidence=understanding.confidence;lead.replies_count=Number(lead.replies_count||0)+1;

   // Step 6: search_inventory runs against the requirement as it now stands.
   const grounded=matches(db,lead);
   const spoken=voice.composeReply({understanding,matches:grounded,leadScore:lead.score||0,hasOpenHandoff,seatsAboveSelfServe:needsKamForBooking(r),locale:s.locale});
   const turn={...understanding,...spoken};

   // Latency accounting (§4). The server can only time its own work, which is the
   // smaller half of the budget. The browser is the only place that knows when the
   // caller actually stopped speaking and when the agent's audio actually started,
   // so it reports that true end-to-end figure for the *previous* agent turn on the
   // next request (it cannot know it before this turn's response exists). Until the
   // client corrects it, the server's own figure stands, marked as such.
   const prev=Number(b.prev_latency_ms);
   if(Number.isFinite(prev)&&prev>=0){
     for(let i=s.turns.length-1;i>=0;i--){if(s.turns[i].from==='agent'){s.turns[i].latency_ms=prev;s.turns[i].latency_source='client';break}}
   }
   const latency=Number(b.latency_ms);
   const callerTurn={id:id('vt_'),from:'caller',text,at:new Date().toISOString(),intent:turn.intent,confidence:turn.confidence,slots_filled:turn.filled};
   const agentTurn={id:id('vt_'),from:'agent',text:turn.reply,at:new Date().toISOString(),
     latency_ms:Number.isFinite(latency)&&latency>=0?latency:(Date.now()-startedAt),
     latency_source:Number.isFinite(latency)&&latency>=0?'client':'server',
     action:turn.decision?.action||null,ask_for:turn.ask_for||null};
   s.turns.push(callerTurn,agentTurn);

   addEvent(db,lead.id,'VOICE_TURN',{session_id:s.id,intent:turn.intent,slots_filled:turn.filled,action:turn.decision?.action||null,latency_ms:agentTurn.latency_ms});
   if(turn.filled.length)addActivity(db,lead.id,'CALL','Requirement captured on call',`${turn.filled.map(f=>f.replaceAll('_',' ')).join(', ')} filled from the caller's own words.`);
   if(turn.objections?.length)addEvent(db,lead.id,'OBJECTION_DETECTED',{objections:turn.objections,channel:'voice'});

   const result=runAutomation(db,lead,{});
   if(turn.end_call){s.status='ENDED';s.ended_at=new Date().toISOString()}
   lead.updated_at=new Date().toISOString();
   save(db);
   return send(res,200,{session:s,reply:turn.reply,ask_for:turn.ask_for,intent:turn.intent,confidence:turn.confidence,
     slots_filled:turn.filled,requirement:r,matches:result.matches,decision:result.decision,
     latency_ms:agentTurn.latency_ms,latency:voice.latencyStats(s.turns),end_call:turn.end_call});
 }

 // Steps 9-12: score, route, write the transcript back, start the cadence.
 if(vsEnd&&req.method==='POST'){
   const s=findSession(vsEnd[1]);if(!s)return send(res,404,{error:'voice session not found'});
   const b=await body(req);
   const lead=db.leads.find(x=>x.id===s.lead_id&&x.tenant_id===TENANT);
   const finalLatency=Number(b.final_latency_ms);
   if(Number.isFinite(finalLatency)&&finalLatency>=0){
     for(let i=s.turns.length-1;i>=0;i--){if(s.turns[i].from==='agent'){s.turns[i].latency_ms=finalLatency;s.turns[i].latency_source='client';break}}
   }
   s.status='ENDED';s.ended_at=s.ended_at||new Date().toISOString();
   s.duration_seconds=Math.max(0,Math.round((new Date(s.ended_at)-new Date(s.started_at))/1000));
   s.latency=voice.latencyStats(s.turns);
   s.transcript=voice.transcriptText(s);
   s.disposition=b.disposition||(s.consent?.granted?'COMPLETED':'CONSENT_DECLINED');
   if(lead){
     const r=requirement(db,lead.id);
     addActivity(db,lead.id,'CALL','Call transcript saved',`${s.turns.filter(t=>t.from==='caller').length} caller turn${s.turns.filter(t=>t.from==='caller').length===1?'':'s'} over ${s.duration_seconds}s. Requirement now at v${r.version||1}.`);
     addEvent(db,lead.id,'VOICE_CALL_ENDED',{session_id:s.id,duration_seconds:s.duration_seconds,latency:s.latency,disposition:s.disposition,turns:s.turns.length});
     // Metering from day one (§13): usage is logged before billing exists.
     db.usage=db.usage||[];
     db.usage.push({id:id('use_'),tenant_id:TENANT,lead_id:lead.id,kind:'voice_minutes',quantity:Math.max(1,Math.ceil(s.duration_seconds/60)),session_id:s.id,at:s.ended_at});
     if(s.consent?.granted){
       const result=runAutomation(db,lead,{});
       s.final_decision=result.decision;
     }
     publishLead(lead);
   }
   save(db);
   return send(res,200,{session:s,lead,latency:s.latency});
 }

 if(vsGet&&req.method==='GET'){
   const s=findSession(vsGet[1]);if(!s)return send(res,404,{error:'voice session not found'});
   return send(res,200,{session:s,lead:db.leads.find(x=>x.id===s.lead_id)||null,requirement:requirement(db,s.lead_id),latency:voice.latencyStats(s.turns)});
 }

 // Simulated telephony webhook (§8.1 step 1). Kept deliberately separate from a
 // real provider callback: with no carrier credentials configured this creates a
 // session marked `simulated`, and says so in the response, rather than implying a
 // PSTN call was answered.
 if(p==='/api/voice/webhook'&&req.method==='POST'){
   const b=await body(req);const status=voice.providerStatus();
   const caller=String(b.from||b.caller||'').trim();
   if(!caller)return send(res,400,{error:'from (caller id) is required'});
   return send(res,202,{accepted:true,simulated:!status.configured,provider:status.provider,
     note:status.configured?'Routed to the configured telephony provider.':'No telephony provider is configured — start a session via POST /api/voice/sessions to run the same flow locally.',
     caller});
 }

 if(p==='/api/demand-gap')return send(res,200,demandGap(db));
 if(p==='/api/seed-demo'&&req.method==='POST'){const b=await body(req),now=new Date().toISOString();if(!b.company)return send(res,400,{error:'company is required'});const l={id:id('lead_'),tenant_id:TENANT,company:b.company,contact:b.contact||'',source:b.source||b.channel||'seed_demo',channel:b.channel||'web',stage:'CAPTURED',score:null,created_at:now,updated_at:now};const r={id:id('req_'),lead_id:l.id,product_type:b.product_type||'private_office',seats:b.seats?Number(b.seats):null,market:b.market||null,budget:b.budget?Number(b.budget):null,move_in_date:b.move_in_date||null,tenure:b.tenure||null,fit_out:b.fit_out||'furnished',notes:b.notes||'',confidence:{},version:1,updated_at:now};db.leads.push(l);db.requirements.push(r);db.activities=db.activities||[];addActivity(db,l.id,'SYSTEM','Lead entered CRM','Seed/demo lead created from the Lead Inbox.');runAutomation(db,l);save(db);return send(res,201,{lead:l,requirement:r,automation:automationConfig(db),matches:matches(db,l)})}
 if(p==='/api/analytics')return send(res,200,analytics(db));
 if(p==='/api/cadence'&&req.method==='GET')return send(res,200,(db.cadence||[]).filter(x=>!x.tenant_id||x.tenant_id===TENANT));
 if(p==='/api/cadence'&&req.method==='PUT'){const b=await body(req);db.cadence=Array.isArray(b.items)?b.items:db.cadence;save(db);return send(res,200,db.cadence)}
 if(p==='/api/chat'&&req.method==='POST'){const b=await body(req);const l=b.lead_id?db.leads.find(x=>x.id===b.lead_id&&x.tenant_id===TENANT):scoped(db.leads)[0];const r=l?requirement(db,l.id):{};const text=String(b.message||'');const nums=text.match(/\b\d+\b/);const slots={...r};if(nums&&!slots.seats)slots.seats=Number(nums[0]);if(/golf course/i.test(text))slots.market='Golf Course Road';if(/cyber/i.test(text))slots.market='Cyber Hub';if(/\₹?\s?15,?000|15000/.test(text))slots.budget=15000;const ms=l?matches(db,{...l,id:l.id}):[];return send(res,200,{intent:'QUALIFY',reply:ms.length?`I found ${ms.length} grounded option${ms.length>1?'s':''}. I can share the shortlist or schedule a tour.`:'I have the requirement. I need one more detail before I can recommend inventory.',slots,matches:ms})}
 if(p==='/api/voice'&&req.method==='POST'){
   // Single-turn convenience endpoint, kept for backwards compatibility. It now
   // runs the same extraction/decision/read-back path as a real session instead of
   // the old hand-rolled regexes, so it can't disagree with the live call screen.
   const b=await body(req);
   const l=b.lead_id?db.leads.find(x=>x.id===b.lead_id&&x.tenant_id===TENANT):scoped(db.leads)[0];
   const r=l?requirement(db,l.id):{};
   const markets=[...new Set(scoped(db.inventory).map(x=>x.market).filter(Boolean))];
   const ms=l?matches(db,l):[];
   const turn=voice.composeTurn({text:String(b.message||''),requirement:r,markets,matches:ms,leadScore:l?.score||0,
     hasOpenHandoff:(db.handoffs||[]).some(h=>h.lead_id===l?.id&&h.status==='OPEN'),seatsAboveSelfServe:needsKamForBooking(r),locale:b.locale||'en'});
   return send(res,200,{intent:turn.intent,reply:turn.reply,slots:turn.slots,matches:ms,decision:turn.decision,ask_for:turn.ask_for,provider:voice.providerStatus()});
 }
 return send(res,404,{error:'not found'})
}catch(e){console.error(e);return send(res,500,{error:e.message||'server error'})}});
server.listen(PORT,()=>console.log(`Deskline API listening on http://localhost:${PORT}`));
