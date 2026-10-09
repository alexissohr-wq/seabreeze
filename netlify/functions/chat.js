exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const body = JSON.parse(event.body);
    const messages = body.messages;
    const leadLogged = body.leadLogged || false;
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const isBusinessHours = et.getDay() >= 1 && et.getDay() <= 5 && et.getHours() >= 8 && et.getHours() < 17;
    const callbackMsg = isBusinessHours ? 'Someone will contact you within the hour to complete your propane account application.' : 'Someone will contact you within the next business day to complete your propane account application.';
    const SYS = ['You are Tank the Turtle, the friendly AI assistant for Sea Breeze Propane, serving Northeast Florida and the Gainesville area (50-mile radius around zip 32609).','Personality: warm, local, knowledgeable, honest. Never pushy.','SERVICE AREA: Northeast Florida (Duval, Nassau, St. Johns, Clay, Baker counties) and Gainesville area (50-mile radius around zip 32609). For out-of-area requests offer an expansion waitlist.','OPENING: Sea Breeze Propane, this is Tank - how can I help you today?','PRICING RULE - CRITICAL: Do NOT quote any prices, costs, or fees under any circumstances. If asked about pricing say: Our team will go over all the pricing with you when they call. Let me get your contact info so we can reach out. Then collect their information.','TANK SIZING: Ask what appliances they plan to run before recommending. Cooking only: 60 gallons. Single appliance such as water heater fireplace or generator: 120 gallons. Heating only under 1500 sq ft: 250 gallons. Full home heating plus water heater plus cooking 1500-3000 sq ft: 500 gallons most popular. Large home over 3000 sq ft: 1000 gallons. Always explain WHY.','RV AND PORTABLE TANKS: Sea Breeze does not fill 20-pound portable tanks, RV tanks, or portable cylinders. We only serve permanent residential and commercial installations.','CYLINDER EXCHANGE: Always ask first whether the need is commercial or residential. Residential: we do not offer cylinder exchange. Commercial forklifts: we do offer daily weekly or monthly forklift cylinder exchange.','TANK OWNERSHIP: Before any delivery request ask: Do you own your tank or is it leased from another company? If they own it proceed to collect contact info. If leased from competitor say: Sounds like we may need to coordinate a tank swap - our team can walk you through the options. Let me get your contact info. If unsure give tips: check for a Property of sticker on the tank, or check if they pay an annual rental fee to a propane company. Offer a callback if still unsure.','CONTACT COLLECTION: For ALL service requests collect in this order: first and last name, zip code, email address, phone number, then ask: Do you agree to receive communications from Sea Breeze Propane? After collecting all info say: ' + callbackMsg,'COMMERCIAL LEADS: Detect warehouse, fleet, forklifts, restaurant, agriculture, port. Ask qualifying questions. Promise specialist callback within 2 hours. Collect company name, first and last name, zip code, email, phone, and communication consent.','GUIDELINES: Handle objections directly. 2-4 sentences per response. No bullet points or markdown headers.','Sea Breeze strengths: no hidden fees, local and responsive, military discount available, referral credits available, remote gauge monitoring available - all details shared during callback.'].join(' ');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1000, system: SYS, messages })
    });
    if (!response.ok) { const errText = await response.text(); console.error('Anthropic error:', response.status, errText); return { statusCode: response.status, headers: { 'Access-Control-Allow-Origin': '*' }, body: errText }; }
    const data = await response.json();
    const text = data.content[0].text;
    let captured = false;
    // leadStatus makes the outcome of lead capture observable instead of silent.
    // Values: null (not attempted), lead_created, lead_suppressed_duplicate,
    // lead_create_failed, hubspot_error, extract_incomplete, extract_parse_error,
    // extract_no_json, extract_api_error, lead_suppressed_open_lead, contact_failed.
    let leadStatus = null;
    if (!leadLogged) {
      const lastUserMsg = messages.length > 0 ? messages[messages.length - 1].content : '';
      const allUserText = messages.filter(function(m) { return m.role === 'user'; }).map(function(m) { return m.content; }).join(' ');
      const hasEmail = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(allUserText);
      const hasPhone = /\b\d{3}[\s.\-]?\d{3}[\s.\-]?\d{4}\b/.test(allUserText);
      const justConsented = /yes|agree|sure|absolutely/i.test(lastUserMsg);
      if (hasEmail && hasPhone && justConsented) {
        console.log('Triggering HubSpot extraction...');
        const allMessages = [...messages, { role: 'assistant', content: text }];
        const convText = allMessages.map(function(m) { return m.role.toUpperCase() + ': ' + m.content; }).join('\n');
        const extractRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 700, messages: [{ role: 'user', content: 'Extract contact info provided by the USER in this conversation, plus a short briefing for the sales rep who will call them back. Return ONLY valid JSON or null. Format: {"name":"full name","email":"...","phone":"digits only","zip":"...","company":"...","type":"lane1 or commercial","consent":true,"summary":"2-4 sentences","tank":"own or leased or unsure or unknown","appliances":"what they want to run, or empty","urgency":"what they said about timing, or empty"}.\n\nRules for the contact fields: only include what the user explicitly stated. Rules for "summary": write it for a rep who has NOT read the chat, in plain sentences, covering what the customer actually wants, anything relevant about their property or current setup, any tank size discussed, and any objection, concern or deadline they raised. Do not invent details and do not include prices. Leave a field as an empty string if the conversation does not cover it.\n\nConversation:\n' + convText }] })
        });
        if (extractRes.ok) {
          const ed = await extractRes.json();
          const et2 = ed.content[0].text.trim();
          if (et2 !== 'null' && et2.includes('{')) {
            try {
              const jm = et2.match(/\{[\s\S]*\}/);
              if (jm) { const parsed = JSON.parse(jm[0]); if (parsed.name && parsed.email && parsed.phone) { leadStatus = await syncToHubSpot(parsed, process.env.HUBSPOT_TOKEN, allMessages); captured = true; console.log('HubSpot logged:', parsed.name, '| result:', leadStatus); } else { leadStatus = 'extract_incomplete'; console.error('Extraction missing name, email or phone:', JSON.stringify(parsed).substring(0,200)); } }
            } catch(e) { leadStatus = 'extract_parse_error'; console.error('Extract parse error:', e.message, '| raw:', et2.substring(0,300)); }
          } else { leadStatus = 'extract_no_json'; console.error('Extraction returned no JSON object:', et2.substring(0,300)); }
        } else { leadStatus = 'extract_api_error'; const eTxt = await extractRes.text(); console.error('Extraction call failed:', extractRes.status, eTxt.substring(0,300)); }
      }
    }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ text: text, captured: captured, leadStatus: leadStatus }) };
  } catch (err) { console.error('Handler error:', err.message); return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: err.message }) }; }
};
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
// The widget opens the chat with an internal prompt asking Tank for a greeting.
// It is not something the customer typed, so keep it out of the rep-facing transcript.
function isPrimerMessage(m) {
  return m.role === 'user' && /Give me a warm 1-2 sentence opening as Tank the Turtle/i.test(m.content || '');
}
function buildTranscriptHtml(allMessages) {
  var NOTE_LIMIT = 30000;
  var lines = (allMessages || []).filter(function(m) { return !isPrimerMessage(m); }).map(function(m) {
    var who = m.role === 'user' ? 'Customer' : 'Tank';
    return '<strong>' + who + ':</strong> ' + esc(m.content).split('\n').join('<br>');
  });
  var html = lines.join('<br><br>');
  if (html.length > NOTE_LIMIT) html = html.slice(0, NOTE_LIMIT) + '<br><br><em>[transcript truncated]</em>';
  return html;
}
// ---- Lead owner -------------------------------------------------------------
// Leads go to Jake, resolved from his email address so nobody has to look up a numeric
// HubSpot owner id. Set HUBSPOT_OWNER_EMAIL in Netlify to hand leads to someone else
// without touching this file. OWNER_ID_FALLBACK is used only if the lookup fails, so a
// lead is never created unassigned.
const OWNER_EMAIL = process.env.HUBSPOT_OWNER_EMAIL || 'jlindauer@seabreezelp.com';
const OWNER_ID_FALLBACK = process.env.HUBSPOT_OWNER_ID || '160505838';
var _ownerIdCache = null;
async function resolveOwnerId(token) {
  if (_ownerIdCache) return { id: _ownerIdCache, resolved: true };
  try {
    var r = await fetch('https://api.hubapi.com/crm/v3/owners/?email=' + encodeURIComponent(OWNER_EMAIL), { headers: { 'Authorization': 'Bearer ' + token } });
    var d = await r.json();
    if (d.results && d.results.length > 0 && d.results[0].id) {
      _ownerIdCache = String(d.results[0].id); // cache successes only
      console.log('Lead owner resolved:', OWNER_EMAIL, '->', _ownerIdCache);
      return { id: _ownerIdCache, resolved: true };
    }
    console.error('Owner lookup found nobody for', OWNER_EMAIL, '- using fallback', OWNER_ID_FALLBACK, '|', JSON.stringify(d).substring(0,200));
  } catch(e) {
    console.error('Owner lookup failed:', e.message, '- using fallback', OWNER_ID_FALLBACK);
  }
  // Fall back so a lead is never created unassigned, but say so in the note too - a silent
  // fallback is how these leads ended up with the wrong owner in the first place.
  return { id: OWNER_ID_FALLBACK, resolved: false };
}

// ---- Source marker for HubSpot alerting -------------------------------------
// Tank writes leads through the API, so they cannot fire the form notifications that
// webform leads do. Stamping a property gives HubSpot something a workflow can enroll on.
// Both are blank until Debbie creates the property, and nothing is stamped while
// TANK_SOURCE_PROPERTY is empty - writing an unknown property would fail the whole
// contact write.
const SOURCE_PROPERTY = process.env.TANK_SOURCE_PROPERTY || '';
const SOURCE_VALUE = process.env.TANK_SOURCE_VALUE || 'Tank AI Chat';

// ---- Open-lead detection ----------------------------------------------------
// One OPEN lead per customer. Every lead already attached to this contact is checked; if
// any is still open, the new chat lands as a note on the contact and no second lead is
// created. Once a lead reaches a closed stage the next chat opens a fresh one.
// CLOSED_LEAD_STAGES holds the hs_pipeline_stage ids that count as closed. While it is
// empty, EVERY existing lead counts as open, which errs toward no duplicates. The stage id
// of each lead found is logged, so the ids needed to fill this in show up in the logs.
const CLOSED_LEAD_STAGES = (process.env.CLOSED_LEAD_STAGES || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
async function findOpenLead(contactId, token) {
  var out = { openLeadId: null, seen: [], lookupFailed: false };
  try {
    var ar = await fetch('https://api.hubapi.com/crm/v4/objects/contacts/' + contactId + '/associations/leads', { headers: { 'Authorization': 'Bearer ' + token } });
    if (!ar.ok) { out.lookupFailed = true; console.error('Lead association lookup failed:', ar.status); return out; }
    var ad = await ar.json();
    var ids = (ad.results || []).map(function(r){ return r.toObjectId || (r.to && r.to.id); }).filter(Boolean).map(String);
    if (!ids.length) return out;
    var br = await fetch('https://api.hubapi.com/crm/v3/objects/leads/batch/read', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ properties: ['hs_pipeline_stage','hs_lead_name'], inputs: ids.map(function(id){ return { id: id }; }) }) });
    if (!br.ok) { out.lookupFailed = true; console.error('Lead batch read failed:', br.status); return out; }
    var bd = await br.json();
    (bd.results || []).forEach(function(l) {
      var stage = String((l.properties && l.properties.hs_pipeline_stage) || '');
      out.seen.push(l.id + ' (stage ' + (stage || 'none') + ')');
      if (!out.openLeadId && CLOSED_LEAD_STAGES.indexOf(stage) === -1) out.openLeadId = l.id;
    });
  } catch(e) { out.lookupFailed = true; console.error('Open-lead lookup threw:', e.message); }
  return out;
}

async function syncToHubSpot(lead, token, allMessages) {
  if (!token) return;
  try {
    var owner = await resolveOwnerId(token);
    var OWNER_ID = owner.id;
    var phoneDigits = lead.phone ? String(lead.phone).replace(/[^0-9]/g,'') : '';
    var props = {};
    var np = lead.name.trim().split(' '); props.firstname = np[0]; props.lastname = np.slice(1).join(' ') || '';
    if (lead.email) props.email = lead.email;
    if (phoneDigits) props.phone = phoneDigits;
    if (lead.zip) props.zip = lead.zip;
    if (SOURCE_PROPERTY) props[SOURCE_PROPERTY] = SOURCE_VALUE;
    // Match on email OR phone. Matching on email alone meant one person who gave a
    // different address on a second chat became a second contact, which is how notes
    // ended up split across two records.
    var filterGroups = [{ filters: [{ propertyName: 'email', operator: 'EQ', value: lead.email }] }];
    if (phoneDigits) filterGroups.push({ filters: [{ propertyName: 'phone', operator: 'EQ', value: phoneDigits }] });
    var contactId = null;
    var sr = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ filterGroups: filterGroups }) });
    var sd = await sr.json(); if (sd.results && sd.results.length > 0) contactId = sd.results[0].id;
    if (contactId) {
      // Do NOT reassign an existing contact's owner - a repeat customer may already belong
      // to another rep, and stealing them is worse than a misfiled Tank lead.
      await fetch('https://api.hubapi.com/crm/v3/objects/contacts/' + contactId, { method: 'PATCH', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ properties: props }) });
      console.log('Updated contact:', contactId);
    } else {
      props.hubspot_owner_id = OWNER_ID;
      var cr = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ properties: props }) });
      var cd = await cr.json(); contactId = cd.id;
      if (!contactId) console.error('Contact CREATE FAILED:', JSON.stringify(cd).substring(0,300));
      else console.log('Created contact:', contactId, '| owner:', OWNER_ID);
    }
    if (!contactId) { console.error('No contactId'); return 'contact_failed'; }
    var note = '<strong>Lead captured by Tank the Turtle</strong>'
      + '<br>Type: ' + esc(lead.type || 'unknown')
      + '<br>Source: seabreezelp.com chat widget'
      + '<br>Consent: Yes'
      + (lead.zip ? '<br>Zip: ' + esc(lead.zip) : '')
      + (lead.company ? '<br>Company: ' + esc(lead.company) : '')
      + (lead.tank && lead.tank !== 'unknown' ? '<br>Tank: ' + esc(lead.tank) : '')
      + (lead.appliances ? '<br>Appliances: ' + esc(lead.appliances) : '')
      + (lead.urgency ? '<br>Timing: ' + esc(lead.urgency) : '');
    if (lead.summary) {
      note += '<br><br><strong>What they need</strong><br>' + esc(lead.summary).split('\n').join('<br>');
    }
    if (!owner.resolved) {
      note += '<br><br><strong>Check lead assignment</strong><br>Could not find a HubSpot user for ' + esc(OWNER_EMAIL) + ', so this was assigned to the fallback owner instead. Someone should fix the owner email or the HubSpot user.';
    }
    var transcript = buildTranscriptHtml(allMessages);
    if (transcript) {
      note += '<br><br><strong>Full chat transcript</strong><br>' + transcript;
    }
    var d2 = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    var leadTitle = lead.name + ' ' + d2.getFullYear() + '-' + String(d2.getMonth()+1).padStart(2,'0') + '-' + String(d2.getDate()).padStart(2,'0');
    // Check for an open lead BEFORE writing the note, so the note can say it was a repeat.
    var leadLook = await findOpenLead(contactId, token);
    if (leadLook.seen.length) console.log('Existing leads on contact', contactId + ':', leadLook.seen.join(', '));
    if (leadLook.openLeadId) {
      note += '<br><br><strong>Repeat chat - existing open lead</strong><br>This customer already has an open lead (lead ' + esc(leadLook.openLeadId) + '), so no second lead was created and all activity stays on that one. The conversation above is from the later chat.';
    }
    await fetch('https://api.hubapi.com/crm/v3/objects/notes', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ properties: { hs_note_body: note, hs_timestamp: Date.now().toString() }, associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }] }) });
    if (leadLook.openLeadId) { console.log('Lead SUPPRESSED - contact already has open lead', leadLook.openLeadId, '| contact:', contactId, '| note written to contact'); return 'lead_suppressed_open_lead'; }
    // If the lookup itself failed we create the lead anyway: a duplicate is annoying, a
    // silently missing lead costs a sale. The log line above says which happened.
    if (leadLook.lookupFailed) console.error('Creating lead despite failed open-lead lookup - watch for a duplicate on contact', contactId);
    var lr = await fetch('https://api.hubapi.com/crm/v3/objects/leads', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ properties: { hs_lead_name: leadTitle, hubspot_owner_id: OWNER_ID }, associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 578 }] }] }) });
    var ld = await lr.json();
    if (!ld.id) { console.error('Lead CREATE FAILED:', JSON.stringify(ld).substring(0,300)); return 'lead_create_failed'; }
    console.log('Lead created:', ld.id, '| contact:', contactId, '| owner:', OWNER_ID, '| title:', leadTitle);
    return 'lead_created';
  } catch(e) { console.error('HubSpot error:', e.message); return 'hubspot_error'; }
}
 
 
