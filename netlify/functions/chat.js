exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const body = JSON.parse(event.body);
    const messages = body.messages;
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const isBusinessHours = et.getDay() >= 1 && et.getDay() <= 5 && et.getHours() >= 8 && et.getHours() < 17;
    const callbackMsg = isBusinessHours ? 'Someone will contact you within the hour to complete your propane account application.' : 'Someone will contact you within the next business day to complete your propane account application.';
    const SYS = ['You are Tank the Turtle, the friendly AI assistant for Sea Breeze Propane, serving Northeast Florida and the Gainesville area (50-mile radius around zip 32609).','Personality: warm, local, knowledgeable, honest. Never pushy.','SERVICE AREA: Northeast Florida (Duval, Nassau, St. Johns, Clay, Baker counties) and Gainesville area. For out-of-area requests offer an expansion waitlist.','OPENING: Sea Breeze Propane, this is Tank - how can I help you today?','LEAD LANE 1 - COT NEEDING DELIVERY:','1. Quote proactively: Our first fill price range is $3.199 to $3.899 per gallon depending on your tank size and usage, plus a one-time $135 system safety check fee. The safety check is required by Florida law before we can start service at any new address.','2. Beyond the first-fill price and one-time safety check, Sea Breeze is a NO-FEE delivery company. No hidden charges.','3. Offer remote gauge monitoring: $99 per year with auto delivery and autopay. Run-out credit of $100.','4. Collect in this order: first and last name, zip code, email address, phone number, then ask: Do you agree to receive communications from Sea Breeze Propane?','5. After collecting all info including communication consent say: ' + callbackMsg,'COMMERCIAL LEADS: Detect warehouse, fleet, forklifts, restaurant, agriculture, port. Ask qualifying questions. Promise specialist callback within 2 hours. Collect company name, first and last name, zip code, email, phone, and ask for communication consent.','GUIDELINES: Explain WHY for recommendations. Handle objections directly. 2-4 sentences. No bullet points or markdown headers.','Differentiators: no hidden fees beyond first fill and safety check, local, fair pricing, military discount 5 cents off per gallon, referral credit $100 on auto-fill signup.'].join(' ');
    const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, system: SYS, messages }) });
    if (!response.ok) return { statusCode: response.status, body: await response.text() };
    const data = await response.json();
    const text = data.content[0].text;
    const userText = messages.filter(function(m) { return m.role === 'user'; }).map(function(m) { return m.content; }).join(' ');
    const lead = extractContact(userText);
    if (lead) { await syncToHubSpot(lead, process.env.HUBSPOT_TOKEN); }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text }) };
  } catch (err) { return { statusCode: 500, body: JSON.stringify({ error: err.message }) }; }
};
function extractContact(t) {
  var em = t.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  var ph = t.match(/\b(\d{3}[\s.\-]?\d{3}[\s.\-]?\d{4})\b/);
  if (!em && !ph) return null;
  var nm = t.match(/(?:my name is|i(?:'m| am)|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i);
  if (!nm) nm = t.match(/name(?:\s+is)?:?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i);
  if (!nm) return null;
  var zp = t.match(/\b(\d{5})\b/);
  var consent = /yes|agree|sure|ok|okay|absolutely/i.test(t);
  var commercial = /warehouse|forklift|fleet|restaurant|manufacturing|port|bulk/i.test(t);
  var co = t.match(/(?:company|business)\s+(?:is\s+)?([A-Z][A-Za-z0-9\s&]+?)(?:\s+and|,|\.|$)/);
  return { name: nm[1].trim(), email: em ? em[0] : null, phone: ph ? ph[0].replace(/[\s.\-]/g,'') : null, zip: zp ? zp[0] : null, consent: consent, company: co ? co[1].trim() : null, type: commercial ? 'commercial' : 'lane1' };
}
async function getOwnerId(token) {
  try {
    var r = await fetch('https://api.hubapi.com/crm/v3/owners?limit=100', { headers: { 'Authorization': 'Bearer ' + token } });
    var d = await r.json();
    var o = (d.results || []).find(function(o) { return (o.firstName||'').toLowerCase().includes('margo') || (o.lastName||'').toLowerCase().includes('meade') || (o.lastName||'').toLowerCase().includes('mmeade'); });
    console.log('Owner lookup:', (d.results||[]).map(function(o){return o.firstName+' '+o.lastName+':'+o.id;}).join(', '));
    return o ? o.id : null;
  } catch(e) { return null; }
}
async function syncToHubSpot(lead, token) {
  if (!token) return;
  try {
    var ownerId = await getOwnerId(token);
    var props = {};
    var np = lead.name.trim().split(' '); props.firstname = np[0]; props.lastname = np.slice(1).join(' ')||'';
    if (lead.email) props.email = lead.email;
    if (lead.phone) props.phone = lead.phone;
    if (lead.zip) props.zip = lead.zip;
    if (ownerId) props.hubspot_owner_id = ownerId;
    props.hs_lead_status = 'NEW';
    var contactId = null;
    if (lead.email) {
      var sr = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', { method: 'POST', headers: { 'Authorization': 'Bearer '+token, 'Content-Type': 'application/json' }, body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: lead.email }] }] }) });
      var sd = await sr.json();
      if (sd.results && sd.results.length > 0) contactId = sd.results[0].id;
    }
    if (contactId) {
      await fetch('https://api.hubapi.com/crm/v3/objects/contacts/'+contactId, { method: 'PATCH', headers: { 'Authorization': 'Bearer '+token, 'Content-Type': 'application/json' }, body: JSON.stringify({ properties: props }) });
      console.log('Updated contact:', contactId);
    } else {
      var cr = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', { method: 'POST', headers: { 'Authorization': 'Bearer '+token, 'Content-Type': 'application/json' }, body: JSON.stringify({ properties: props }) });
      var cd = await cr.json(); contactId = cd.id; console.log('Created contact:', contactId);
    }
    if (!contactId) { console.error('No contactId'); return; }
    var note = 'Lead captured by Tank the Turtle\nType: '+(lead.type||'unknown')+'\nSource: seabreezelp.com chat widget\nConsent: '+(lead.consent?'Yes':'Pending')+(lead.zip?'\nZip: '+lead.zip:'')+(lead.company?'\nCompany: '+lead.company:'');
    await fetch('https://api.hubapi.com/crm/v3/objects/notes', { method: 'POST', headers: { 'Authorization': 'Bearer '+token, 'Content-Type': 'application/json' }, body: JSON.stringify({ properties: { hs_note_body: note, hs_timestamp: Date.now().toString() }, associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }] }) });
    var d2 = new Date(); var leadTitle = lead.name+' '+d2.getFullYear()+'-'+String(d2.getMonth()+1).padStart(2,'0');
    var lsr = await fetch('https://api.hubapi.com/crm/v3/objects/leads/search', { method: 'POST', headers: { 'Authorization': 'Bearer '+token, 'Content-Type': 'application/json' }, body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'hs_lead_name', operator: 'EQ', value: leadTitle }] }], properties: ['hs_lead_name'] }) });
    var lsd = await lsr.json();
    if (lsd.results && lsd.results.length > 0) { console.log('Lead exists:', lsd.results[0].id); return; }
    var leadProps = { hs_lead_name: leadTitle };
    if (ownerId) leadProps.hubspot_owner_id = ownerId;
    var lr = await fetch('https://api.hubapi.com/crm/v3/objects/leads', { method: 'POST', headers: { 'Authorization': 'Bearer '+token, 'Content-Type': 'application/json' }, body: JSON.stringify({ properties: leadProps, associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 578 }] }] }) });
    var ld = await lr.json(); console.log('Lead created:', ld.id||JSON.stringify(ld).substring(0,150));
  } catch(e) { console.error('HubSpot error:', e.message); }
}