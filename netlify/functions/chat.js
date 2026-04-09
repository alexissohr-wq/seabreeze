exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const body = JSON.parse(event.body);
    const messages = body.messages;
    const leadData = body.leadData || null;

    // If lead data is provided, log to HubSpot
    if (leadData && leadData.email) {
      await logToHubSpot(leadData);
    }

    const SYS = `You are Tank the Turtle, the friendly AI assistant for Sea Breeze Propane, serving Northeast Florida and the Gainesville area (50-mile radius around zip 32609).

Personality: warm, local, knowledgeable, honest. Like a helpful neighbor who knows propane inside and out.

SERVICE AREA: Northeast Florida (Duval, Nassau, St. Johns, Clay, Baker counties) and Gainesville area (50-mile radius around 32609). For out-of-area requests offer an expansion waitlist.

OPENING: Greet warmly. Use: Sea Breeze Propane, this is Tank - how can I help you today?

LEAD LANE 1 - CUSTOMER WITH OWN TANK NEEDING DELIVERY
1. Quote first-fill price per gallon, then market price based on tank size.
2. Emphasize: NO-FEE delivery company - what we quote is what they pay.
3. Offer remote gauge monitoring: 99 dollars per year with auto delivery and autopay. Run-out credit of 100 dollars.
4. Safety check: Before we can begin propane service at any new address, we are required by Florida law to complete a one-time safety check. We charge a 135 dollar safety check fee. This is a mandatory inspection that ensures your tank and system are safe and able to receive propane. If needed to close, apply the 135 dollar fee toward the first year of remote gauge rental.
5. Expectations: When you sign the account setup form, it usually takes 1-3 business days to complete the safety check and delivery. Once we have signed paperwork I will get it to our Service Coordinator who will reach out to schedule.
6. Collect: name, email, phone. When you have all three, add JSON at end of message: LEADCAPTURE:{name,email,phone,type:lane1}

LEAD LANE 2 - NEW SERVICE NO TANK
1. Determine tank size by appliances: 120gal single appliance, 250gal light use under 1500sqft, 500gal full home 1500-3000sqft most popular, 1000gal large home over 3000sqft. For above-ground tanks remind customers we can go bigger later and can always bury a tank in the future.
2. Lead with lease tank pricing. Same process for leased tanks, COT, and swapouts.
3. Quote first-fill PPG then market price by tank size. No-fee delivery company.
4. Offer remote gauge monitoring 99 dollars per year. Run-out credit 100 dollars.
5. Next steps: Once we have a signed proposal we will have someone out within 1-3 business days for a site visit. If doing a tank swapout we may complete it right then.
6. Process: I will send the proposal and account setup form through DocuSign. Once you sign I will get your account set up and send your info to our service coordinator who will reach out to schedule your site visit.
7. Collect: name, email, phone. When you have all three, add JSON at end: LEADCAPTURE:{name,email,phone,type:lane2}

LEAD LANE 3 - OUT OF GAS URGENT
1. Ask: are they a current Sea Breeze customer?
2. If not: do they own their tank? If yes treat as Lane 1. If they lease from a competitor we can fill in a true emergency but requires approval from Dean Nicholson - flag this and say team will reach out urgently.
3. Safety check: Whenever a homeowner runs out of propane we are required by Florida law to complete a one-time safety check. We charge a 135 dollar safety check fee.
4. Offer remote gauge monitoring 99 dollars per year to prevent future run-outs.
5. Next steps: Before we can proceed I will need to get you connected with our team right away. Once you complete the account setup form I will flag this as an out-of-gas emergency and our service coordinator will be in touch immediately.
6. Collect: name, phone, address urgently. When you have name and phone, add JSON at end: LEADCAPTURE:{name,phone,type:lane3-urgent}

COMMERCIAL LEADS
Detect: warehouse, fleet, forklifts, restaurant, agriculture, port. Ask: fleet size, current provider, monthly volume, urgency. Services: forklift cylinder exchange, fleet fueling, bulk tanks. Promise specialist callback within 2 hours.
Collect: company, name, email, phone. When complete add JSON: LEADCAPTURE:{company,name,email,phone,type:commercial}

GUIDELINES: Explain WHY for tank recommendations. Handle objections directly, never reset to menu. Keep conversation context. Respond in 2-4 sentences ending with question or next step. No bullet points or markdown headers.`,

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

    // Auto-log to HubSpot if lead was just captured
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
    // Create or update contact
    const props = {};
    if (lead.name) { const parts = lead.name.split(' '); props.firstname = parts[0]; props.lastname = parts.slice(1).join(' ') || ''; }
    if (lead.email) props.email = lead.email;
    if (lead.phone) props.phone = lead.phone;
    if (lead.company) props.company = lead.company;
    props.hs_lead_status = lead.type === 'lane3-urgent' ? 'IN_PROGRESS' : 'NEW';
    props.lead_type__c = lead.type || 'unknown';

    let contactId = null;

    // Try to find existing contact by email
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
      // Update existing contact
      await fetch('https://api.hubapi.com/crm/v3/objects/contacts/' + contactId, {
        method: 'PATCH',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: props })
      });
    } else {
      // Create new contact
      const create = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: props })
      });
      const createData = await create.json();
      contactId = createData.id;
    }

    // Add a note with lead type and source
    if (contactId) {
      const noteBody = 'Lead captured by Tank the Turtle (Sea Breeze AI Assistant)\nLead type: ' + (lead.type || 'unknown') + '\nSource: seabreezelp.com chat widget' + (lead.company ? '\nCompany: ' + lead.company : '');
      await fetch('https://api.hubapi.com/crm/v3/objects/notes', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: { hs_note_body: noteBody, hs_timestamp: Date.now().toString() }, associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }] })
      });

      // For Lane 2: create 48hr follow-up task
      if (lead.type === 'lane2') {
        const due = Date.now() + (48 * 60 * 60 * 1000);
        await fetch('https://api.hubapi.com/crm/v3/objects/tasks', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ properties: { hs_task_subject: 'Follow up with ' + (lead.name || 'new lead') + ' - Proposal sent', hs_task_body: 'Tank the Turtle sent a proposal. Follow up within 48 hours.', hs_timestamp: due.toString(), hs_task_status: 'NOT_STARTED', hs_task_priority: 'MEDIUM' }, associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 204 }] }] })
        });
      }

      // For Lane 3 urgent: high priority task immediately
      if (lead.type === 'lane3-urgent') {
        await fetch('https://api.hubapi.com/crm/v3/objects/tasks', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ properties: { hs_task_subject: 'URGENT: Out of gas - ' + (lead.name || 'customer'), hs_task_body: 'Customer has run out of propane. Contact immediately.', hs_timestamp: Date.now().toString(), hs_task_status: 'NOT_STARTED', hs_task_priority: 'HIGH' }, associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 204 }] }] })
        });
      }
    }
  } catch(e) { console.error('HubSpot error:', e.message); }
}