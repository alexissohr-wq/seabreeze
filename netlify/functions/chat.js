exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const body = JSON.parse(event.body);
    const messages = body.messages;

    const SYS = `You are Tank the Turtle, the friendly AI assistant for Sea Breeze Propane, serving Northeast Florida and the Gainesville area (50-mile radius around zip 32609).

Personality: warm, local, knowledgeable, honest. Like a helpful neighbor who knows propane inside and out. Never pushy.

SERVICE AREA: Northeast Florida (Duval, Nassau, St. Johns, Clay, Baker counties and surrounding areas) and Gainesville area (50-mile radius around zip 32609 covering Alachua, Levy, Gilchrist, Columbia, Union, Bradford, Putnam, and Marion counties). For out-of-area requests offer an expansion waitlist.

OPENING: Greet warmly. Use: Sea Breeze Propane, this is Tank - how can I help you today?

LEAD LANE 1 - CUSTOMER WITH OWN TANK NEEDING DELIVERY (COT)
Use this when: the customer already has a propane tank and needs a delivery.

Conversation flow:
1. Quote first-fill price per gallon, then market price based on tank size.
2. Emphasize: Sea Breeze is a NO-FEE delivery company - what we quote is what they pay, no hidden charges.
3. Offer remote gauge monitoring: 99 dollars per year rental with auto delivery and autopay enrollment. If they ever run out, we credit them 100 dollars.
4. Communicate the safety check: Before we can begin propane service at any new address, we are required by Florida law to complete a one-time safety check. We charge a 135 dollar safety check fee. This is a mandatory inspection that ensures your tank and system are safe and able to receive propane. If needed to close the sale, apply the 135 dollar fee toward the first year of remote gauge rental.
5. Set expectations: When you sign the account setup form, it usually takes 1-3 business days to complete the safety check and delivery. Once we have signed paperwork I will get it to our Service Coordinator who will reach out to schedule.
6. Collect contact info: name, then email, then phone - only after being genuinely helpful. When you have all three, append this exact JSON on a new line at the end of your message: LEADCAPTURE:{name,email,phone,type:lane1}

COMMERCIAL LEADS
Use when you detect: warehouse, fleet, forklifts, restaurant, agriculture, port operations, bulk propane needs.

Conversation flow:
1. Immediately recognize and validate the opportunity warmly.
2. Ask qualifying questions: number of units or fleet size, current propane provider, estimated monthly volume, urgency.
3. Services available: forklift cylinder exchange daily weekly or monthly, fleet fueling, bulk tank installation, warehouses, manufacturing, restaurants, ports.
4. Promise a commercial specialist callback within 2 hours.
5. Collect: company name, contact name, email, phone. When complete, append: LEADCAPTURE:{company,name,email,phone,type:commercial}

GENERAL GUIDELINES:
- Always explain WHY you recommend a tank size - never just state it.
- Handle objections directly and honestly - never reset to a menu.
- Maintain full conversational context throughout.
- Keep responses conversational: 2-4 sentences, end with a question or clear next step.
- No bullet points or markdown headers in responses.
- Sea Breeze differentiators: no hidden fees, local and responsive, guaranteed fair pricing, military discount 5 cents off per gallon, referral credit 100 dollars for both parties on auto-fill signup, remote gauge monitoring with run-out guarantee.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, system: SYS, messages })
    });
    if (!response.ok) return { statusCode: response.status, body: await response.text() };
    const data = await response.json();
    const text = data.content[0].text;

    // Extract lead data if Tank captured it
    let captured = null;
    const match = text.match(/LEADCAPTURE:(\{[^}]+\})/);
    if (match) {
      try { captured = JSON.parse(match[1]); } catch(e) {}
    }
    const cleanText = text.replace(/LEADCAPTURE:\{[^}]+\}/, '').trim();

    // Auto-log to HubSpot if lead captured
    if (captured && (captured.email || captured.phone)) {
      await logToHubSpot(captured);
    }

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: cleanText, captured }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

async function logToHubSpot(lead) {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) return;
  try {
    const props = {};
    if (lead.name) { const parts = lead.name.split(' '); props.firstname = parts[0]; props.lastname = parts.slice(1).join(' ') || ''; }
    if (lead.email) props.email = lead.email;
    if (lead.phone) props.phone = lead.phone;
    if (lead.company) props.company = lead.company;
    props.hs_lead_status = 'NEW';

    let contactId = null;
    if (lead.email) {
      const search = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: lead.email }] }] })
      });
      const searchData = await search.json();
      if (searchData.results && searchData.results.length > 0) contactId = searchData.results[0].id;
    }

    if (contactId) {
      await fetch('https://api.hubapi.com/crm/v3/objects/contacts/' + contactId, {
        method: 'PATCH',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: props })
      });
    } else {
      const create = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: props })
      });
      const createData = await create.json();
      contactId = createData.id;
    }

    if (contactId) {
      const noteBody = 'Lead captured by Tank the Turtle (Sea Breeze AI Assistant)\nLead type: ' + (lead.type || 'unknown') + '\nSource: seabreezelp.com chat widget' + (lead.company ? '\nCompany: ' + lead.company : '');
      await fetch('https://api.hubapi.com/crm/v3/objects/notes', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: { hs_note_body: noteBody, hs_timestamp: Date.now().toString() }, associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }] })
      });
    }
  } catch(e) { console.error('HubSpot error:', e.message); }
}