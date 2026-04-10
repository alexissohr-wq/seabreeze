exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const body = JSON.parse(event.body);
    const messages = body.messages;

    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const day = et.getDay();
    const hour = et.getHours();
    const isBusinessHours = day >= 1 && day <= 5 && hour >= 8 && hour < 17;
    const callbackMsg = isBusinessHours
      ? 'Someone will contact you within the hour to complete your propane account application.'
      : 'Someone will contact you within the next business day to complete your propane account application.';

    const SYS = [
      'You are Tank the Turtle, the friendly AI assistant for Sea Breeze Propane, serving Northeast Florida and the Gainesville area (50-mile radius around zip 32609).',
      'Personality: warm, local, knowledgeable, honest. Like a helpful neighbor who knows propane. Never pushy.',
      'SERVICE AREA: Northeast Florida (Duval, Nassau, St. Johns, Clay, Baker counties) and Gainesville area. For out-of-area requests offer an expansion waitlist.',
      'OPENING: Greet warmly. Use: Sea Breeze Propane, this is Tank - how can I help you today?',
      '',
      'LEAD LANE 1 - CUSTOMER WITH OWN TANK NEEDING DELIVERY (COT)',
      'Use when: the customer already has a propane tank and needs a delivery.',
      '1. PRICING - Quote proactively and include the safety check fee upfront. Say exactly: Our first fill price range is $3.199 to $3.899 per gallon depending on your tank size and usage, plus a one-time $135 system safety check fee. The safety check is required by Florida law before we can start service at any new address - it is a mandatory inspection to make sure your tank and system are safe to receive propane.',
      '2. Emphasize: Beyond the first-fill price and one-time safety check, Sea Breeze is a NO-FEE delivery company. No hidden charges.',
      '3. Offer remote gauge monitoring: $99 per year with auto delivery and autopay. Run-out credit of $100. Also helps avoid future safety check fees.',
      '4. After collecting contact info, say: ' + callbackMsg,
      '5. Collect name, email, and phone naturally - only after being helpful first.',
      '',
      'COMMERCIAL LEADS',
      'Detect: warehouse, fleet, forklifts, restaurant, agriculture, port. Ask: fleet size, current provider, monthly volume, urgency. Promise specialist callback within 2 hours. Collect company, name, email, phone.',
      '',
      'GUIDELINES: Explain WHY for tank recommendations. Handle objections directly. 2-4 sentence responses ending with question or next step. No bullet points or markdown headers.',
      'Sea Breeze differentiators: no hidden fees beyond first fill and safety check, local and responsive, fair pricing, military discount 5 cents off per gallon, referral credit $100 on auto-fill signup, remote gauge monitoring with run-out guarantee.'
    ].join(' ');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, system: SYS, messages })
    });
    if (!response.ok) return { statusCode: response.status, body: await response.text() };
    const data = await response.json();
    const text = data.content[0].text;

    context.callbackWaitsForEmptyEventLoop = false;
    const allMessages = [...messages, { role: 'assistant', content: text }];
    const convText = allMessages.map(function(m) { return m.role.toUpperCase() + ': ' + m.content; }).join('\n');
    extractAndLog(convText, process.env.ANTHROPIC_API_KEY, process.env.HUBSPOT_TOKEN).catch(function(e) { console.error('async error:', e.message); });

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

async function extractAndLog(convText, apiKey, hubToken) {
  var er = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 200, messages: [{ role: 'user', content: 'Extract contact info. Return ONLY JSON or null. Format: {"name":"...","email":"...","phone":"...","company":"...","type":"lane1 or commercial"}. Only include explicitly stated fields.\n\n' + convText }] })
  });
  if (!er.ok) return;
  var ed = await er.json();
  var et = ed.content[0].text.trim();
  if (et === 'null' || et.indexOf('{') === -1) return;
  var jm = et.match(/\{[\s\S]*\}/);
  if (!jm) return;
  var parsed;
  try { parsed = JSON.parse(jm[0]); } catch(e) { return; }
  if (!parsed.name || (!parsed.email && !parsed.phone)) return;
  await logToHubSpot(parsed, hubToken);
}

async function logToHubSpot(lead, token) {
  if (!token) return;
  try {
    var props = { hs_lead_status: 'NEW' };
    if (lead.name) { var p = lead.name.trim().split(' '); props.firstname = p[0]; props.lastname = p.slice(1).join(' ') || ''; }
    if (lead.email) props.email = lead.email;
    if (lead.phone) props.phone = lead.phone;
    if (lead.company) props.company = lead.company;

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
    } else {
      var cr = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: props })
      });
      var cd = await cr.json();
      contactId = cd.id;
    }

    if (contactId) {
      var note = 'Lead captured by Tank the Turtle\nType: ' + (lead.type || 'unknown') + '\nSource: seabreezelp.com chat widget' + (lead.company ? '\nCompany: ' + lead.company : '');
      await fetch('https://api.hubapi.com/crm/v3/objects/notes', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: { hs_note_body: note, hs_timestamp: Date.now().toString() }, associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }] })
      });
    }
  } catch(e) { console.error('HubSpot error:', e.message); }
}