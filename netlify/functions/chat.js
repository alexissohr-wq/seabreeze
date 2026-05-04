exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
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
      'PRICING RULE - CRITICAL: Do NOT quote any prices, costs, or fees under any circumstances. If asked about pricing say: Our team will go over all the pricing with you when they call. Let me get your contact info so we can reach out. Then collect their information.',
      'TANK SIZING: Ask what appliances they plan to run before recommending. Cooking only: 60 gallons. Single appliance such as water heater fireplace or generator: 120 gallons. Heating only under 1500 sq ft: 250 gallons. Full home heating plus water heater plus cooking 1500-3000 sq ft: 500 gallons most popular. Large home over 3000 sq ft: 1000 gallons. Always explain WHY.',
      'RV AND PORTABLE TANKS: Sea Breeze does not fill 20-pound portable tanks, RV tanks, or portable cylinders. We only serve permanent residential and commercial installations.',
      'CYLINDER EXCHANGE: Always ask first whether the need is commercial or residential. Residential: we do not offer cylinder exchange. Commercial forklifts: we do offer daily weekly or monthly forklift cylinder exchange.',
      'TANK OWNERSHIP: Before any delivery request ask: Do you own your tank or is it leased from another company? If they own it proceed to collect contact info. If leased from competitor say: Sounds like we may need to coordinate a tank swap - our team can walk you through the options. Let me get your contact info. If unsure give tips: check for a Property of sticker on the tank, or check if they pay an annual rental fee to a propane company. Offer a callback if still unsure.',
      'CONTACT COLLECTION: For ALL service requests collect in this order: first and last name, zip code, email address, phone number, then ask: Do you agree to receive communications from Sea Breeze Propane? After collecting all info say: ' + callbackMsg,
      'COMMERCIAL LEADS: Detect warehouse, fleet, forklifts, restaurant, agriculture, port. Ask qualifying questions. Promise specialist callback within 2 hours. Collect company name, first and last name, zip code, email, phone, and communication consent.',
      'GUIDELINES: Handle objections directly. 2-4 sentences per response. No bullet points or markdown headers.',
      'Sea Breeze strengths: no hidden fees, local and responsive, military discount available, referral credits available, remote gauge monitoring available - all details shared during callback.'
    ].join(' ');

    // Main Tank response
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, system: SYS, messages })
    });
    if (!response.ok) return { statusCode: response.status, headers: { 'Access-Control-Allow-Origin': '*' }, body: await response.text() };
    const data = await response.json();
    const text = data.content[0].text;

    // Extract contact info from FULL conversation using Claude - catches multi-turn info
    const allMessages = [...messages, { role: 'assistant', content: text }];
    const convText = allMessages.map(function(m) { return m.role.toUpperCase() + ': ' + m.content; }).join('\n');
    const extractRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{ role: 'user', content: 'Extract contact info provided by the USER (not the assistant) in this conversation. Return ONLY valid JSON or the word null. Format: {"name":"full name","email":"...","phone":"...","zip":"...","company":"...","type":"lane1 or commercial","consent":true or false}. Only include fields explicitly stated by the user. Phone digits only no formatting.\n\nConversation:\n' + convText }]
      })
    });

    let captured = null;
    if (extractRes.ok) {
      const ed = await extractRes.json();
      const et2 = ed.content[0].text.trim();
      if (et2 !== 'null' && et2.includes('{')) {
        try {
          const jm = et2.match(/\{[\s\S]*\}/);
          if (jm) {
            const parsed = JSON.parse(jm[0]);
            if (parsed.name && (parsed.email || parsed.phone)) {
              captured = parsed;
              await syncToHubSpot(parsed, process.env.HUBSPOT_TOKEN);
            }
          }
        } catch(e) { console.error('Extract parse error:', e.message); }
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ text: text, captured: !!captured })
    };
  } catch (err) {
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: err.message }) };
  }
};

async function syncToHubSpot(lead, token) {
  if (!token) return;
  const OWNER_ID = '160505838';
  try {
    var props = { hubspot_owner_id: OWNER_ID };
    var np = lead.name.trim().split(' '); props.firstname = np[0]; props.lastname = np.slice(1).join(' ') || '';
    if (lead.email) props.email = lead.email;
    if (lead.phone) props.phone = String(lead.phone).replace(/[^0-9]/g,'');
    if (lead.zip) props.zip = lead.zip;

    var contactId = null;
    if (lead.email) {
      var sr = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: lead.email }] }] })
      });
      var sd = await sr.json();
      if (sd.results && sd.results.length > 0) contactId = sd.results[0].id;
    }

    if (contactId) {
      await fetch('https://api.hubapi.com/crm/v3/objects/contacts/' + contactId, {
        method: 'PATCH', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: props })
      });
      console.log('Updated contact:', contactId);
    } else {
      var cr = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: props })
      });
      var cd = await cr.json(); contactId = cd.id;
      console.log('Created contact:', contactId);
    }

    if (!contactId) { console.error('No contactId'); return; }

    var note = 'Lead captured by Tank the Turtle\nType: ' + (lead.type||'unknown') + '\nSource: seabreezelp.com chat widget\nConsent: ' + (lead.consent?'Yes':'Pending') + (lead.zip?'\nZip: '+lead.zip:'') + (lead.company?'\nCompany: '+lead.company:'');
    await fetch('https://api.hubapi.com/crm/v3/objects/notes', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { hs_note_body: note, hs_timestamp: Date.now().toString() }, associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }] })
    });

    var d2 = new Date();
    var leadTitle = lead.name + ' ' + d2.getFullYear() + '-' + String(d2.getMonth()+1).padStart(2,'0');
    var lsr = await fetch('https://api.hubapi.com/crm/v3/objects/leads/search', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'hs_lead_name', operator: 'EQ', value: leadTitle }] }], properties: ['hs_lead_name'] })
    });
    var lsd = await lsr.json();
    if (lsd.results && lsd.results.length > 0) { console.log('Lead exists:', lsd.results[0].id); return; }

    var lr = await fetch('https://api.hubapi.com/crm/v3/objects/leads', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { hs_lead_name: leadTitle, hubspot_owner_id: OWNER_ID }, associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 578 }] }] })
    });
    var ld = await lr.json();
    console.log('Lead created:', ld.id || JSON.stringify(ld).substring(0,150));
  } catch(e) { console.error('HubSpot error:', e.message); }
}