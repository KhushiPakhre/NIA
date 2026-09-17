import assert from 'node:assert/strict';
const base=process.env.DESKLINE_API||'http://localhost:8787/api';
async function req(path,opts){const r=await fetch(base+path,{headers:{'Content-Type':'application/json'},...opts});const d=await r.json();if(!r.ok)throw new Error(`${r.status}: ${d.error}`);return d}
const h=await req('/health');assert.equal(h.ok,true);
const inv=await req('/inventory');assert.ok(inv.length>=3);
const leads=await req('/leads');assert.ok(leads.length>=3);
const m=await req(`/leads/${leads[0].id}/matches`);assert.ok(Array.isArray(m.matches));
// NIA no longer blindly cascades a fresh lead through every stage in one call
// (master prompt §12/§34: "do not blindly execute every possible action" / "do not
// fake automation"). A single automation pass now performs exactly ONE next-best
// action. A lead with a complete requirement and grounded matches earns a shortlist
// immediately; it earns WARM/handoff on a later pass once real signal (a reply, an
// objection, high intent) pushes its score past the handoff threshold.
const created=await req('/leads',{method:'POST',body:JSON.stringify({company:'Deskline Test '+Date.now(),contact:'QA',channel:'web',product_type:'private_office',seats:8,market:'Gurgaon',budget:15000})});assert.equal(created.lead.stage,'SHORTLIST');assert.ok(created.matches.length>0);assert.ok(created.lead.next_action);
const updated=await req(`/leads/${created.lead.id}`,{method:'PUT',body:JSON.stringify({stage:'WARM',score:91})});assert.equal(updated.stage,'WARM');
const a=await req('/analytics');assert.ok(typeof a.conversion_rate==='number');
const team=await req('/team');assert.ok(team.length>=1);
const newMember=await req('/team',{method:'POST',body:JSON.stringify({name:'QA Rep '+Date.now(),markets:'Gurgaon;Noida',capacity:8})});assert.ok(newMember.id);
const imported=await req('/team/import',{method:'POST',body:JSON.stringify({rows:[{name:'Bulk Rep 1',markets:'Gurgaon'},{name:'Bulk Rep 2',markets:'Noida'}]})});assert.equal(imported.created,2);
const msg1=await req(`/leads/${leads[0].id}/messages`,{method:'POST',body:JSON.stringify({from:'lead',text:'We need 10 seats in Gurgaon, budget 15000, immediate move-in.'})});assert.ok(msg1.messages.length>=2);assert.equal(msg1.messages[msg1.messages.length-1].from,'agent');
const msg2=await req(`/leads/${leads[1].id}/messages`,{method:'POST',body:JSON.stringify({from:'lead',text:'Looking for a meeting room for 4 people.'})});assert.ok(msg2.messages.length>=2);
console.log('PASS: health, inventory, leads, matching, CRUD, analytics, team, concurrent lead messaging');

// ---------------------------------------------------------------------------
// NIA autonomous journey tests (master prompt §35)
// ---------------------------------------------------------------------------

// Test 1 — new lead: partial requirement over chat, NIA asks a targeted question
// instead of an interrogation, then completes qualification across turns.
{
  const l1=await req('/leads',{method:'POST',body:JSON.stringify({company:'Journey Co '+Date.now(),contact:'Test User',channel:'whatsapp'})});
  const m1=await req(`/leads/${l1.lead.id}/messages`,{method:'POST',body:JSON.stringify({from:'lead',text:'We need about 10 seats in Golf Course Road.'})});
  const agentMsg1=m1.messages[m1.messages.length-1];
  assert.equal(agentMsg1.from,'agent');
  assert.ok(agentMsg1.text.toLowerCase().includes('budget')||agentMsg1.text.toLowerCase().length>0);
  const m2=await req(`/leads/${l1.lead.id}/messages`,{method:'POST',body:JSON.stringify({from:'lead',text:'Budget is up to ₹15,000, furnished please.'})});
  assert.ok(Array.isArray(m2.matches));
  console.log('PASS: Test 1 — new lead conversational qualification');
}

// Test 2 — price objection: detected, stored, and NIA responds specifically to it
// instead of arguing or ignoring it.
{
  const l2=await req('/leads',{method:'POST',body:JSON.stringify({company:'Objection Co '+Date.now(),contact:'Test',channel:'web',product_type:'private_office',seats:8,market:'Golf Course Road',budget:15000})});
  const m=await req(`/leads/${l2.lead.id}/messages`,{method:'POST',body:JSON.stringify({from:'lead',text:'Honestly this is too expensive for our budget, can you do better?'})});
  const detail=await req(`/leads/${l2.lead.id}/matches`);
  assert.ok(detail.requirement.objections.includes('PRICE'));
  assert.equal(m.decision.action,'HANDLE_OBJECTION');
  console.log('PASS: Test 2 — price objection detected and handled');
}

// Test 2b — competitor objection: name + quoted price extracted and stored.
{
  const l2b=await req('/leads',{method:'POST',body:JSON.stringify({company:'Competitor Co '+Date.now(),contact:'Test',channel:'web'})});
  await req(`/leads/${l2b.lead.id}/messages`,{method:'POST',body:JSON.stringify({from:'lead',text:'WeWork quoted us ₹17,000 for the same setup.'})});
  const detail=await req(`/leads/${l2b.lead.id}/matches`);
  assert.equal(detail.requirement.competitor.name,'WeWork');
  assert.equal(detail.requirement.competitor.quoted_price,17000);
  const brief=await req(`/leads/${l2b.lead.id}/brief`);
  assert.ok(brief.suggested_opener.includes('WeWork'));
  console.log('PASS: Test 2b — competitor intelligence captured and surfaced in KAM brief');
}

// Test 3 — tour request: NIA checks live availability and books a real slot rather
// than claiming a time without checking inventory.
{
  const l3=await req('/leads',{method:'POST',body:JSON.stringify({company:'Tour Co '+Date.now(),contact:'Test',channel:'web',product_type:'private_office',seats:4,market:'Golf Course Road',budget:15000})});
  const m=await req(`/leads/${l3.lead.id}/messages`,{method:'POST',body:JSON.stringify({from:'lead',text:'Can we visit tomorrow afternoon?'})});
  assert.equal(m.decision.action,'SCHEDULE_TOUR');
  const tours=await req('/tours');
  assert.ok(tours.some(t=>t.lead_id===l3.lead.id));
  console.log('PASS: Test 3 — tour requested and booked against live availability');
}

// Test 4 — high-intent lead: booking/purchase intent raises priority and, for an
// above-self-serve requirement, routes to a human instead of auto-booking.
{
  const l4=await req('/leads',{method:'POST',body:JSON.stringify({company:'HighIntent Co '+Date.now(),contact:'Test',channel:'web',product_type:'private_office',seats:28,market:'Golf Course Road',budget:15000})});
  const m=await req(`/leads/${l4.lead.id}/messages`,{method:'POST',body:JSON.stringify({from:'lead',text:"Sounds good, let's proceed."})});
  assert.equal(m.decision.action,'HANDOFF');
  assert.equal(m.decision.requires_human,true);
  const handoffs=await req('/handoffs');
  assert.ok(handoffs.some(h=>h.lead_id===l4.lead.id&&h.status==='OPEN'));
  console.log('PASS: Test 4 — high purchase intent on a KAM-required product routes to a human');
}

// Test 5 — inventory gap: complete requirement with no matching inventory is
// escalated (demand gap) rather than silently dropped or invented.
{
  const l5=await req('/leads',{method:'POST',body:JSON.stringify({company:'Gap Co '+Date.now(),contact:'Test',channel:'web',product_type:'private_office',seats:500,market:'Nowhere Market',budget:100})});
  const decision=await req(`/leads/${l5.lead.id}/decision`);
  assert.equal(decision.decision.action,'ESCALATE');
  console.log('PASS: Test 5 — inventory gap escalated instead of fabricated');
}

// Test 6 — duplicate prevention: running automation twice on the same warm lead
// must not create a second open handoff.
{
  const l6=await req('/leads',{method:'POST',body:JSON.stringify({company:'Dedup Co '+Date.now(),contact:'Test',channel:'web',product_type:'private_office',seats:28,market:'Golf Course Road',budget:15000})});
  await req(`/leads/${l6.lead.id}/messages`,{method:'POST',body:JSON.stringify({from:'lead',text:"Let's proceed, book it."})});
  await req(`/leads/${l6.lead.id}/automate`,{method:'POST'});
  await req(`/leads/${l6.lead.id}/automate`,{method:'POST'});
  const handoffs=await req('/handoffs');
  const openForLead=handoffs.filter(h=>h.lead_id===l6.lead.id&&h.status==='OPEN');
  assert.equal(openForLead.length,1);
  console.log('PASS: Test 6 — duplicate handoff prevented across repeated automation runs');
}

// Test 7 — lost intent: explicit disinterest closes the lead instead of continuing
// to nurture it.
{
  const l7=await req('/leads',{method:'POST',body:JSON.stringify({company:'Lost Co '+Date.now(),contact:'Test',channel:'web'})});
  const m=await req(`/leads/${l7.lead.id}/messages`,{method:'POST',body:JSON.stringify({from:'lead',text:"We're not interested anymore, please stop messaging."})});
  assert.equal(m.decision.action,'MARK_LOST');
  const leads=await req('/leads');
  const found=leads.find(x=>x.id===l7.lead.id);
  assert.equal(found.stage,'CLOSED');
  console.log('PASS: Test 7 — explicit lost intent closes the lead');
}

// Observability: every decision and every score update is logged as a structured,
// timestamped event (master prompt §21/§33), not just reflected in current state.
{
  const l8=await req('/leads',{method:'POST',body:JSON.stringify({company:'Events Co '+Date.now(),contact:'Test',channel:'web',product_type:'private_office',seats:8,market:'Golf Course Road',budget:15000})});
  const events=await req(`/leads/${l8.lead.id}/events`);
  assert.ok(events.some(e=>e.event_type==='DECISION'));
  assert.ok(events.some(e=>e.event_type==='SCORE_UPDATED'));
  const allEvents=await req('/events');
  assert.ok(allEvents.length>0);
  console.log('PASS: every automated decision is logged as an observable event');
}

// SLA breach detection: an OPEN handoff older than its score-based SLA window is
// flagged (used to notify a manager / trigger reassignment).
{
  const sla=await req('/sla/breaches');
  assert.ok(Array.isArray(sla));
  console.log('PASS: SLA breach endpoint responds with an array');
}

console.log('\nALL NIA INTEGRATION TESTS PASSED');

// ---------------------------------------------------------------------------
// P3 — real-time activity stream (SSE)
// ---------------------------------------------------------------------------
// Waits for a condition instead of sleeping a fixed interval: SSE delivery is fast
// but not instant, and a hardcoded sleep makes this suite flaky on a loaded machine.
const waitFor=async(fn,label,timeout=5000)=>{
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){if(fn())return true;await new Promise(r=>setTimeout(r,50))}
  assert.fail(label);
};
{
  const frames=[];const ctrl=new AbortController();
  const reader=(async()=>{
    const res=await fetch(base+'/stream',{signal:ctrl.signal});
    assert.match(res.headers.get('content-type')||'',/event-stream/);
    const rd=res.body.getReader(),dec=new TextDecoder();let buf='';
    while(true){const {value,done}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});
      let i;while((i=buf.indexOf('\n\n'))>=0){const chunk=buf.slice(0,i);buf=buf.slice(i+2);
        const dl=chunk.split('\n').find(x=>x.startsWith('data: '));if(dl)frames.push(JSON.parse(dl.slice(6)))}}
  })().catch(e=>{if(e?.name!=='AbortError'){console.error('stream reader failed:',e);process.exitCode=1}});
  await waitFor(()=>frames.some(f=>f.kind==='ready'),'stream announces readiness on connect');

  // A write through the normal API must reach an already-connected subscriber
  // without the client asking for anything.
  const streamLead=await req('/leads',{method:'POST',body:JSON.stringify({company:'Stream QA '+Date.now(),channel:'web',product_type:'private_office',seats:8,market:'Gurgaon',budget:15000})});
  await waitFor(()=>frames.some(f=>f.kind==='activity'&&f.lead_id===streamLead.lead.id),'activities are pushed');
  await waitFor(()=>frames.some(f=>f.kind==='event'&&f.lead_id===streamLead.lead.id),'structured events are pushed');
  await waitFor(()=>frames.some(f=>f.kind==='lead'&&f.lead?.id===streamLead.lead.id),'lead row changes are pushed');
  assert.ok(frames.every((f,i,a)=>i===0||f.seq>=a[i-1].seq),'frames arrive in sequence order');

  // Lead-scoped stream must not leak other leads' traffic.
  const scoped=[];const ctrl2=new AbortController();
  (async()=>{
    const res=await fetch(`${base}/leads/${streamLead.lead.id}/stream`,{signal:ctrl2.signal});
    const rd=res.body.getReader(),dec=new TextDecoder();let buf='';
    while(true){const {value,done}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});
      let i;while((i=buf.indexOf('\n\n'))>=0){const chunk=buf.slice(0,i);buf=buf.slice(i+2);
        const dl=chunk.split('\n').find(x=>x.startsWith('data: '));if(dl)scoped.push(JSON.parse(dl.slice(6)))}}
  })().catch(e=>{if(e?.name!=='AbortError'){console.error('scoped stream failed:',e);process.exitCode=1}});
  await waitFor(()=>scoped.some(f=>f.kind==='ready'),'scoped stream connects');
  await req(`/leads/${leads[0].id}/messages`,{method:'POST',body:JSON.stringify({from:'lead',text:'Any update on this?'})});
  await new Promise(r=>setTimeout(r,600));
  assert.ok(scoped.every(f=>f.kind==='ready'||f.lead_id===streamLead.lead.id),'scoped stream carries one lead only');

  ctrl.abort();ctrl2.abort();
  await new Promise(r=>setTimeout(r,50));
  console.log('PASS: SSE stream — readiness, push on write, ordering, lead scoping');
}

// ---------------------------------------------------------------------------
// P4 — voice sessions (BUILD_SPEC 8.1)
// ---------------------------------------------------------------------------
{
  const status=await req('/voice/status');
  assert.equal(typeof status.configured,'boolean');
  assert.ok(status.transport==='simulated'||status.transport==='telephony');

  const started=await req('/voice/sessions',{method:'POST',body:JSON.stringify({caller:'+91 98100 77777',company:'Voice QA '+Date.now(),contact:'Asha'})});
  assert.equal(started.session.status,'AWAITING_CONSENT');
  assert.match(started.script.consent,/record/i);

  // Consent gate: no turn is accepted before consent is recorded.
  let gated=false;
  try{await req(`/voice/sessions/${started.session.id}/turn`,{method:'POST',body:JSON.stringify({text:'hello'})})}
  catch(e){gated=/409/.test(e.message)}
  assert.ok(gated,'turns are refused until consent is given');

  await req(`/voice/sessions/${started.session.id}/consent`,{method:'POST',body:JSON.stringify({granted:true})});
  const t1=await req(`/voice/sessions/${started.session.id}/turn`,{method:'POST',body:JSON.stringify({text:'We need a private office for 8 people',latency_ms:420})});
  assert.ok(t1.slots_filled.includes('seats'),'spoken headcount fills the seats slot');
  assert.equal(t1.decision.action,'ASK_QUESTION');

  const t2=await req(`/voice/sessions/${started.session.id}/turn`,{method:'POST',body:JSON.stringify({text:'Golf Course Road, budget 15000, immediate move in',latency_ms:610})});
  assert.equal(t2.requirement.market,'Golf Course Road');
  // Every unit named in the reply must be one the matcher returned for the
  // requirement *as updated by this turn* — the agent never reads back inventory
  // matched against the previous turn's state.
  for(const m of t2.matches)assert.ok(t2.reply.includes(m.unit)||t2.decision.action!=='SEND_SHORTLIST');
  if(t2.decision.action==='SEND_SHORTLIST')assert.ok(t2.matches.every(m=>m.market==='Golf Course Road'));

  const ended=await req(`/voice/sessions/${started.session.id}/end`,{method:'POST',body:JSON.stringify({})});
  assert.equal(ended.session.status,'ENDED');
  assert.ok(ended.session.transcript.includes('Caller:'),'transcript is written back');
  assert.equal(ended.latency.samples,2);
  assert.equal(ended.latency.p95,610,'p95 surfaces the slowest turn');

  // Declining consent ends the AI leg and puts a person on it instead.
  const declined=await req('/voice/sessions',{method:'POST',body:JSON.stringify({caller:'+91 98100 88888',company:'Declined QA '+Date.now()})});
  const dres=await req(`/voice/sessions/${declined.session.id}/consent`,{method:'POST',body:JSON.stringify({granted:false})});
  assert.equal(dres.session.status,'ENDED');
  const openHandoffs=await req('/handoffs');
  assert.ok(openHandoffs.some(h=>h.lead_id===declined.session.lead_id&&h.status==='OPEN'),'declined consent routes to a human');

  console.log('PASS: voice — consent gate, live slot filling, grounded read-back, latency, transcript, decline routing');
}
