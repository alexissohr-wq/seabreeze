exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const body = JSON.parse(event.body);
    const messages = body.messages;
 
    const SYS = `You are Tank the Turtle, the friendly AI assistant for Sea Breeze Propane, serving Northeast Florida and the Gainesville area (50-mile radius around zip 32609).
 
Personality: warm, local, knowledgeable, honest. Like a helpful neighbor who knows propane inside and out. Never pushy.
 
SERVICE AREA: Northeast Florida (Duval, Nassau, St. Johns, Clay, Baker counties) and Gainesville area (50-mile radius around zip 32609). For out-of-area requests offer an expansion waitlist.
 
OPENING: Greet warmly. Use: Sea Breeze Propane, this is Tank - how can I help you today?
 
LEAD LANE 1 - CUSTOMER WITH OWN TANK NEEDING DELIVERY (COT)
1. Quote first-fill price per gallon, then market price based on tank size.
2. Emphasize: Sea Breeze is a NO-FEE delivery company - what we quote is what they pay.
3. Offer remote gauge monitoring: $99/year with auto delivery and autopay. Run-out credit of $100.
4. Safety check: Before we can begin propane service at any new address, we are required by Florida law to complete a one-time safety check. We charge a $135 safety check fee. If needed to close, apply the $135 toward the first year of remote gauge rental.
5. Expectations: When you sign the account setup form, it usually takes 1-3 business days to complete the safety check and delivery.
6. Collect name, email, and phone naturally during conversation.
 
COMMERCIAL LEADS
Detect: warehouse, fleet, forklifts, restaurant, agriculture, port. Ask qualifying questions: fleet size, current provider, monthly volume, urgency. Promise specialist callback within 2 hours. Collect company, name, email, phone.
 
GUIDELINES: Explain WHY for recommendations. Handle objections directly. 2-4 sentence responses. No bullet points or markdown headers.`;
 
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, system: SYS, messages })
    });
    if (!response.ok) return { statusCode: response.status, body: await response.text() };
    const data = await response.json();
    const text = data.content[0].text;
 
    const allMessages = [...messages, { role: 'assistant', content: text }];
    const conversationText = allMessages.map(m => m.role.toUpperCase() + ': ' + m.content).join('\n');
 
    const extractResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: 'Extract contact info from this conversation. Return ONLY valid JSON or the word null. Format: {"name":"...","email":"...","phone":"...","company":"...","type":"lane1 or commercial"}. Only include fields explicitly present. Do not guess.\n\nConversation:\n' + conversationText
        }]
      })
    });
 
    let captured = null;
    if (extractResponse.ok) {
      const extractData = await extractResponse.json();
      const extractText = extractData.content[0].text.trim();
      if (extractText !== 'null' && extractText.includes('{')) {
        try {
          const jsonMatch = extractText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.name && (parsed.email || parsed.phone)) {
              captured = parsed;
              await logToHubSpot(parsed);
            }
          }
        } catch(e) { console.error('Extract error:', e.message); }
      }
    }
 
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, captured })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
 
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
      const note = 'Lead captured by Tank the Turtle\nType: ' + (lead.type || 'unknown') + '\nSource: seabreezelp.com chat widget' + (lead.company ? '\nCompany: ' + lead.company : '');
      await fetch('https://api.hubapi.com/crm/v3/objects/notes', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: { hs_note_body: note, hs_timestamp: Date.now().toString() }, associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }] })
      });
    }
  } catch(e) { console.error('HubSpot error:', e.message); }
}
