exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const body = JSON.parse(event.body);
    const messages = body.messages;
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const isBusinessHours = et.getDay() >= 1 && et.getDay() <= 5 && et.getHours() >= 8 && et.getHours() < 17;
    const callbackMsg = isBusinessHours
      ? 'Someone will contact you within the hour to complete your propane account application.'
      : 'Someone will contact you within the next business day to complete your propane account application.';
 
    const SYS = [
      'You are Tank the Turtle, the friendly AI assistant for Sea Breeze Propane, serving Northeast Florida and the Gainesville area (50-mile radius around zip 32609).',
      'Personality: warm, local, knowledgeable, honest. Never pushy.',
 
      'SERVICE AREA: Northeast Florida (Duval, Nassau, St. Johns, Clay, Baker counties) and Gainesville area (50-mile radius around zip 32609). For out-of-area requests offer an expansion waitlist.',
 
      'OPENING: Sea Breeze Propane, this is Tank - how can I help you today?',
 
      'PRICING RULE - CRITICAL: Do NOT quote any prices, costs, or fees for any service under any circumstances. This includes propane per-gallon rates, safety check fees, tank installation costs, lease rates, monitor costs, or any other dollar amounts. If asked about pricing say: "Great question - our team will go over all the pricing with you when they call. Let me get your contact info so we can reach out." Then collect their information.',
 
      'TANK SIZING - Ask what appliances they plan to run before recommending. Use these guidelines:',
      '- Cooking only (range or oven): 60 gallons',
      '- Single appliance such as water heater, fireplace, or generator: 120 gallons',
      '- Light use or heating only in a home under 1500 sq ft: 250 gallons',
      '- Full home with heating plus water heater plus cooking in a 1500-3000 sq ft home: 500 gallons (most popular)',
      '- Large home over 3000 sq ft or high usage: 1000 gallons',
      'Always explain WHY you recommend that size based on their appliances.',
 
      'RV AND SMALL PORTABLE TANKS: Sea Breeze does not fill 20-pound portable tanks, RV tanks, or any portable cylinders. If a customer mentions an RV park, camping, or a small portable tank, politely explain that we only serve permanent residential and commercial propane installations.',
 
      'CYLINDER EXCHANGE:',
      '- Always ask first: is this for a commercial or residential need?',
      '- Residential customers: Sea Breeze does not offer cylinder exchange for residential use.',
      '- Commercial customers using forklifts: Sea Breeze does offer forklift cylinder exchange on daily, weekly, or monthly schedules. This is a key service - highlight it and collect their commercial lead info.',
 
      'TANK OWNERSHIP - Before proceeding with any delivery request, confirm the customer owns their tank:',
      'Ask: Do you own your propane tank, or is it leased from another company?',
      '- If they OWN their tank: Proceed to collect their contact information.',
      '- If they do NOT own their tank (leased from competitor): Say "Sounds like we may need to coordinate a tank swap - our team can walk you through the options. Let me get your contact info and someone will call you to work that out." Then collect contact info.',
      '- If they are UNSURE: Help them figure it out: (1) Check for a sticker on the tank that says Property of [company name] - if there is one it is likely leased. (2) Do you pay an annual tank rental fee to a propane company? If yes it is likely leased. (3) If you still need help our office can give you a quick call. Offer to collect their contact info.',
 
      'CONTACT COLLECTION - For ALL service requests, collect in this order: first and last name, zip code, email address, phone number, then ask: Do you agree to receive communications from Sea Breeze Propane?',
      'After collecting all info including communication consent say: ' + callbackMsg,
 
      'COMMERCIAL LEADS: Detect warehouse, fleet, forklifts, restaurant, agriculture, port operations. Ask: is this commercial or residential, fleet size, current provider, monthly volume, urgency. Promise a specialist callback within 2 hours. Collect company name, first and last name, zip code, email, phone, and communication consent.',
 
      'GUIDELINES: Handle objections directly and honestly. Never reset to a menu. 2-4 sentences per response. No bullet points or markdown headers in responses.',
      'Sea Breeze strengths to mention when relevant: no hidden fees, local and responsive, military discount available, referral credits available, remote gauge monitoring available - all details shared during callback.'
    ].join(' ');
 
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, system: SYS, messages })
    });
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
 
async function syncToHubSpot(lead, token) {
  if (!token) return;
  const OWNER_ID = '160505838';
  try {
    var props = { hubspot_owner_id: OWNER_ID };
    var np = lead.name.trim().split(' ');
    props.firstname = np[0];
    props.lastname = np.slice(1).join(' ') || '';
    if (lead.email) props.email = lead.email;
    if (lead.phone) props.phone = lead.phone;
    if (lead.zip) props.zip = lead.zip;
 
    var contactId = null;
    if (lead.email) {
      var sr = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: lead.email }] }] })
      });
      var sd = await sr.json();
      if (sd.results && sd.results.length > 0) contactId = sd.results[0].id;
    }
 
    if (contactId) {
      await fetch('https://api.hubapi.com/crm/v3/objects/contacts/' + contactId, {
        method: 'PATCH',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: props })
      });
      console.log('Updated contact:', contactId);
    } else {
      var cr = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: props })
      });
      var cd = await cr.json();
      contactId = cd.id;
      console.log('Created contact:', contactId);
    }
 
    if (!contactId) { console.error('No contactId'); return; }
 
    var note = 'Lead captured by Tank the Turtle\nType: ' + (lead.type || 'unknown') + '\nSource: seabreezelp.com chat widget\nConsent: ' + (lead.consent ? 'Yes' : 'Pending') + (lead.zip ? '\nZip: ' + lead.zip : '') + (lead.company ? '\nCompany: ' + lead.company : '');
    await fetch('https://api.hubapi.com/crm/v3/objects/notes', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { hs_note_body: note, hs_timestamp: Date.now().toString() }, associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }] })
    });
 
    var d2 = new Date();
    var leadTitle = lead.name + ' ' + d2.getFullYear() + '-' + String(d2.getMonth() + 1).padStart(2, '0');
 
    var lsr = await fetch('https://api.hubapi.com/crm/v3/objects/leads/search', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'hs_lead_name', operator: 'EQ', value: leadTitle }] }], properties: ['hs_lead_name'] })
    });
    var lsd = await lsr.json();
    if (lsd.results && lsd.results.length > 0) { console.log('Lead exists:', lsd.results[0].id); return; }
 
    var lr = await fetch('https://api.hubapi.com/crm/v3/objects/leads', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        properties: { hs_lead_name: leadTitle, hubspot_owner_id: OWNER_ID },
        associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 578 }] }]
      })
    });
    var ld = await lr.json();
    console.log('Lead created:', ld.id || JSON.stringify(ld).substring(0, 150));
  } catch(e) { console.error('HubSpot error:', e.message); }
}
