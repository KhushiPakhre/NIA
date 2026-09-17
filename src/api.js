const API = import.meta.env.VITE_API_URL || 'http://localhost:8787/api';
async function request(path, options={}){
  const res=await fetch(`${API}${path}`,{headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
  const text=await res.text(); let data={}; try{data=text?JSON.parse(text):{}}catch{data={raw:text}};
  if(!res.ok) throw new Error(data.error||`Request failed (${res.status})`);
  return data;
}
export const api={
 health:()=>request('/health'), tenant:()=>request('/tenant'),
 inventory:()=>request('/inventory'), addInventory:(x)=>request('/inventory',{method:'POST',body:JSON.stringify(x)}), importInventory:(rows)=>request('/inventory/import',{method:'POST',body:JSON.stringify({rows})}),
 leads:()=>request('/leads'), createLead:(x)=>request('/leads',{method:'POST',body:JSON.stringify(x)}), updateLead:(id,x)=>request(`/leads/${id}`,{method:'PUT',body:JSON.stringify(x)}), matches:(id)=>request(`/leads/${id}/matches`),
 bookings:()=>request('/bookings'), createBooking:(x)=>request('/bookings',{method:'POST',body:JSON.stringify(x)}), updateBooking:(id,x)=>request(`/bookings/${id}`,{method:'PUT',body:JSON.stringify(x)}),
 tours:()=>request('/tours'), createTour:(x)=>request('/tours',{method:'POST',body:JSON.stringify(x)}), updateTour:(id,x)=>request(`/tours/${id}`,{method:'PUT',body:JSON.stringify(x)}),
 handoffs:()=>request('/handoffs'), createHandoff:(x)=>request('/handoffs',{method:'POST',body:JSON.stringify(x)}), updateHandoff:(id,x)=>request(`/handoffs/${id}`,{method:'PUT',body:JSON.stringify(x)}),
 analytics:()=>request('/analytics'), demandGap:()=>request('/demand-gap'), automation:()=>request('/automation'), updateAutomation:(x)=>request('/automation',{method:'PUT',body:JSON.stringify(x)}), cadence:()=>request('/cadence'), updateCadence:(x)=>request('/cadence',{method:'PUT',body:JSON.stringify(x)}),
 chat:(x)=>request('/chat',{method:'POST',body:JSON.stringify(x)}), voice:(x)=>request('/voice',{method:'POST',body:JSON.stringify(x)}), activities:(id)=>request(`/leads/${id}/activity`), addActivity:(x)=>request('/activities',{method:'POST',body:JSON.stringify(x)}), aiSummary:(id)=>request(`/leads/${id}/ai-summary`,{method:'POST'}), shortlist:(id)=>request(`/leads/${id}/shortlist`,{method:'POST'}), warm:(id)=>request(`/leads/${id}/warm`,{method:'POST'}), handoff:(id)=>request(`/leads/${id}/handoff`,{method:'POST'}), automate:(id)=>request(`/leads/${id}/automate`,{method:'POST'}), seedDemo:(x)=>request('/seed-demo',{method:'POST',body:JSON.stringify(x)}),
 team:()=>request('/team'), addTeamMember:(x)=>request('/team',{method:'POST',body:JSON.stringify(x)}), importTeam:(rows)=>request('/team/import',{method:'POST',body:JSON.stringify({rows})}), updateTeamMember:(id,x)=>request(`/team/${id}`,{method:'PUT',body:JSON.stringify(x)}), removeTeamMember:(id)=>request(`/team/${id}`,{method:'DELETE'}),
 messages:(id)=>request(`/leads/${id}/messages`), sendMessage:(id,x)=>request(`/leads/${id}/messages`,{method:'POST',body:JSON.stringify(x)}),
 decision:(id)=>request(`/leads/${id}/decision`), brief:(id)=>request(`/leads/${id}/brief`), leadEvents:(id)=>request(`/leads/${id}/events`), events:()=>request('/events'), slaBreaches:()=>request('/sla/breaches'),

 // --- P4: voice sessions (BUILD_SPEC 8.1) ---
 voiceStatus:()=>request('/voice/status'),
 voiceSessions:()=>request('/voice/sessions'),
 voiceSession:(id)=>request(`/voice/sessions/${id}`),
 startCall:(x)=>request('/voice/sessions',{method:'POST',body:JSON.stringify(x)}),
 callConsent:(id,granted)=>request(`/voice/sessions/${id}/consent`,{method:'POST',body:JSON.stringify({granted})}),
 callTurn:(id,x)=>request(`/voice/sessions/${id}/turn`,{method:'POST',body:JSON.stringify(x)}),
 endCall:(id,x={})=>request(`/voice/sessions/${id}/end`,{method:'POST',body:JSON.stringify(x)})
};

// --- P3: real-time activity stream -----------------------------------------
// EventSource handles reconnection and Last-Event-ID resume on its own; the server
// replays anything missed while disconnected, so a dropped connection costs a few
// seconds of delay rather than a hole in the feed.
export function openStream({leadId=null,onFrame,onStatus}={}){
  const url=leadId?`${API}/leads/${leadId}/stream`:`${API}/stream`;
  let es;
  try{es=new EventSource(url)}
  catch(err){onStatus?.('error');return ()=>{}}
  const relay=(e)=>{try{onFrame?.(JSON.parse(e.data))}catch{/* keep-alive or partial frame */}};
  for(const kind of ['ready','activity','event','lead'])es.addEventListener(kind,relay);
  es.onmessage=relay;
  es.onopen=()=>onStatus?.('live');
  es.onerror=()=>onStatus?.(es.readyState===2?'closed':'reconnecting');
  return ()=>{try{es.close()}catch{}onStatus?.('closed')};
}
