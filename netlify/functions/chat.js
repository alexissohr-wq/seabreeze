exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const body = JSON.parse(event.body);
    const messages = body.messages;

    // Business hours check (M-F 8am-5pm Eastern)
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const day = et.getDay();
    const hour = et.getHours();
    const isBusinessHours = day >= 1 && day <= 5 && hour >= 8 && hour < 17;
    const callbackMsg = isBusinessHours
      ? 'Someone will contact you within the hour to complete your propane account application.'
      : 'Someone will contact you within the next business day to complete your propane account application.';

    const SYS = 'You are Tank the Turtle, the friendly AI assistant for Sea Breeze Propane, serving Northeast Florida and the Gainesville area (50-mile radius around zip 32609). Personality: warm, local, knowledgeable, honest. Like a helpful neighbor who knows propane. Never pushy. SERVICE AREA: Northeast Florida (Duval, Nassau, St. Johns, Clay, Baker counties) and Gainesville area. For out-of-area offer expansion waitlist. OPENING: Sea Breeze Propane, this is Tank - how can I help you today? LEAD LANE 1 - COT NEEDING DELIVERY: 1. PRICING - Always quote proactively and include the safety check fee upfront. Say: Our first fill price range is $3.199 to $3.899 per gallon depending on your tank size and usage, plus a one-time $135 system safety check fee. The safety check is required by Florida law before we can start service at any new address - it is a mandatory inspection to make sure your tank and system are safe to receive propane. 2. Beyond the first-fill price and one-time safety check, Sea Breeze is a NO-FEE delivery company. No hidden charges. 3. Offer remote gauge monitoring: $99 per year with auto delivery and autopay. Run-out credit of $100. Also helps avoid future safety check fees. 4. After collecting contact info say exactly: ' + callbackMsg + ' 5. Collect name, email, and phone naturally - only after being helpful first. COMMERCIAL LEADS: Detect warehouse, fleet, forklifts, restaurant, agriculture, port. Ask: fleet size, current provider, monthly volume, urgency. Promise specialist callback within 2 hours. Collect company, name, email, phone. GUIDELINES: Explain WHY for recommendations. Handle objections directly. 2-4 sentence responses. No bullet points or markdown headers. Differentiators: no hidden fees beyond first fill and safety check, local and responsive, fair pricing, military discount 5 cents off per gallon, referral credit $100 on auto-fill signup.';
    // Main Tank response
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, system: SYS, messages })
    });
    if (!response.ok) return { statusCode: response.status, body: await response.text() };
    const data = await response.json();
    const text = data.content[0].text;

    // Fire HubSpot extraction async - does not block response
    const allMessages = [...messages, { role: 'assistant', content: text }];
    const conversationText = allMessages.map(m => m.role.toUpperCase() + ': ' + m.content).join('
');
    context.callbackWaitsForEmptyEventLoop = false;
    extractAndLog(conversationText).catch(e => console.error('Async extract error:', e.message));

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

async function extractAndLog(conversationText) {
  const extractResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{ role: 'user', content: 'Extract contact info from this conversation. Return ONLY valid JSON or the word null. Format: {"name":"...","email":"...","phone":"...","company":"...","type":"lane1 or commercial"}. Only include fields explicitly stated. Do not guess.

Conversation:
' + conversationText }]
    })
  });
  if (!extractResponse.ok) return;
  const ed = await extractResponse.json();
  const etxt = ed.content[0].text.trim();
  if (etxt === 'null' || !etxt.includes('{')) return;
  const jm = etxt.match(/{[sS]*}/);
  if (!jm) return;
  const parsed = JSON.parse(jm[0]);
  if (parsed.name && (parsed.email || parsed.phone)) {
    await logToHubSpot(parsed);
  }
}

async function logToHubSpot(lead) {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) return;
  try {
    const props = {};
    if (lead.name) { const p = lead.name.trim().split(' '); props.firstname = p[0]; props.lastname = p.slice(1).join(' ') || ''; }
    if (lead.email) props.email = lead.email;
    if (lead.phone) props.phone = lead.phone;
    if (lead.company) props.company = lead.company;
    props.hs_lead_status = 'NEW';

    let contactId = null;
    if (lead.email) {
      const s = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: lead.email }] }] })
      });
      const sd = await s.json();
      if (sd.results && sd.results.length > 0) contactId = sd.results[0].id;
    }

    if (contactId) {
      await fetch('https://api.hubapi.com/crm/v3/objects/contacts/' + contactId, {
        method: 'PATCH',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: props })
      });
    } else {
      const c = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: props })
      });
      const cd = await c.json();
      contactId = cd.id;
    }

    if (contactId) {
      const note = 'Lead captured by Tank the Turtle
Type: ' + (lead.type || 'unknown') + '
Source: seabreezelp.com chat widget' + (lead.company ? '
Company: ' + lead.company : '');
      await fetch('https://api.hubapi.com/crm/v3/objects/notes', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: { hs_note_body: note, hs_timestamp: Date.now().toString() }, associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }] })
      });
    }
  } catch(e) { console.error('HubSpot error:', e.message); }
}