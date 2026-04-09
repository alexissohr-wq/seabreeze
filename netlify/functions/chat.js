exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const { messages, leadData } = JSON.parse(event.body);

    const SYS = `You are Tank the Turtle, the friendly and knowledgeable AI assistant for Sea Breeze Propane, serving Northeast Florida and the Gainesville area (50-mile radius around zip 32609).

Your personality: warm, local, knowledgeable, honest. You sound like a helpful neighbor who knows propane inside and out. You are confident but never pushy.

SERVICE AREA: Northeast Florida (Duval, Nassau, St. Johns, Clay, Baker counties) and Gainesville area (50-mile radius around 32609 covering Alachua, Levy, Gilchrist, Columbia, Union, Bradford, Putnam, Marion counties). For out-of-area, offer expansion waitlist.

OPENING: Greet warmly - mirror Sea Breeze standard: Sea Breeze Propane this is Tank how can I help you today.

LEAD LANE 1 - CUSTOMER WITH OWN TANK NEEDING DELIVERY
Use when customer already has a tank and needs delivery.
1. Quote first-fill price per gallon then market price based on tank size.
2. Emphasize Sea Breeze is a NO-FEE delivery company - what we quote is what they pay, no hidden charges.
3. Offer remote gauge monitoring: 99 dollars per year rental with auto delivery and autopay. If they ever run out we credit them 100 dollars.
4. Safety check: Before we can begin propane service at any new address we are required by Florida law to complete a one-time safety check. We charge a 135 dollar safety check fee. This is a mandatory inspection that ensures your tank and system are safe and able to receive propane. If needed to close, apply 135 dollar fee toward first year remote gauge rental.
5. Expectations: When you sign the account setup form it usually takes 1-3 business days to complete the safety check and delivery. Once we have signed paperwork I will get it to our Service Coordinator who will reach out to schedule.
6. Collect: name, email, phone. When you have all three, say LEAD_CAPTURED in your response so the system can log it.

LEAD LANE 2 - NEW SERVICE NO TANK
Use when customer needs a new tank installed.
1. Determine tank size by appliances: 120gal single appliance (generator 7-22kW, water heater, outdoor kitchen, fireplace), 250gal light use heating only under 1500sqft, 500gal full home heating plus water heater plus cooking 1500-3000sqft most popular, 1000gal large home over 3000sqft. For above-ground tanks remind customers we can always go bigger and can always bury a tank in the future.
2. Lead with lease tank pricing. Same process for leased tanks, COT and tank swapouts.
3. Quote first-fill PPG then market price by tank size.
4. Emphasize NO-FEE delivery - what we quote is what they pay.
5. Offer remote gauge: 99 dollars per year auto delivery autopay. Run-out credit 100 dollars.
6. Next steps: Once we have a signed proposal we will have someone out within 1-3 business days for a site visit. If doing a swapout we may complete it right then.
7. Process: I will send the proposal and account setup form through DocuSign. Once you sign I will get your account set up and send your info to our service coordinator to schedule.
8. Collect: name, email, phone. When you have all three, say LEAD_CAPTURED in your response.

LEAD LANE 3 - OUT OF GAS URGENT
Use when customer has run out of propane.
1. Determine if current Sea Breeze customer.
2. If not: do they own their tank? If yes proceed as Lane 1. If they lease from competitor we can fill in true emergency but needs approval from Dean Nicholson - flag this and say team will reach out urgently.
3. Safety check: Whenever a homeowner runs out of propane we are required by Florida law to complete a one-time safety check. We charge a 135 dollar safety check fee. This is mandatory and ensures tank and system are safe to receive propane.
4. Offer gauge monitoring 99 dollars per year to prevent future run-outs.
5. Next steps: Before we can proceed I will need to get you connected with our team right away. Once you complete the account setup form I will flag this as an out-of-gas emergency and our service coordinator will be in touch immediately.
6. Collect name, phone, address urgently. When collected say LEAD_CAPTURED_URGENT in your response.

COMMERCIAL LEADS
When you detect commercial intent (warehouse, fleet, forklifts, restaurant, agriculture, port):
- Recognize immediately and validate warmly.
- Ask qualifying questions: fleet size, current provider, monthly volume, urgency.
- Services: forklift cylinder exchange daily/weekly/monthly, fleet fueling, bulk tanks, warehouses, manufacturing, restaurants, ports.
- Promise commercial specialist callback within 2 hours.
- Collect company name, contact name, email, phone. When collected say LEAD_CAPTURED_COMMERCIAL.

GENERAL:
- Always explain WHY you recommend a tank size.
- Handle objections directly - never reset to a menu.
- Maintain full conversational context.
- Collect contact info only after being genuinely helpful.
- Responses 2-4 sentences, end with question or next step.
- No bullet points or markdown headers.
- Differentiators: no hidden fees, local and responsive, fair pricing, military discount 5 cents per gallon, referral credit 100 dollars both parties on auto-fill.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, system: SYS, messages })
    });
    if (!response.ok) return { statusCode: response.status, body: await response.text() };
    const data = await response.json();
    const text = data.content[0].text;

    let hubspotResult = null;
    const isUrgent = text.includes('LEAD_CAPTURED_URGENT');
    const isCommercial = text.includes('LEAD_CAPTURED_COMMERCIAL');
    const isStandard = text.includes('LEAD_CAPTURED');

    if ((isUrgent || isCommercial || isStandard) && leadData && leadData.email) {
      try {
        const laneLabel = isUrgent ? 'Lane 3 - Out of Gas URGENT' : isCommercial ? 'Commercial Lead' : 'Lane 1/2 - Standard';
        const hsContact = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.HUBSPOT_TOKEN },
          body: JSON.stringify({
            properties: {
              firstname: (leadData.name || '').split(' ')[0] || '',
              lastname: (leadData.name || '').split(' ').slice(1).join(' ') || '',
              email: leadData.email || '',
              phone: leadData.phone || '',
              company: leadData.company || '',
              hs_lead_status: isUrgent ? 'IN_PROGRESS' : 'NEW',
              lead_type__sea_breeze_: laneLabel
            }
          })
        });
        const contactData = await hsContact.json();
        const contactId = contactData.id;

        if (contactId) {
          const convo = messages.map(m => m.role.toUpperCase() + ': ' + m.content).join('\n');
          await fetch('https://api.hubapi.com/crm/v3/objects/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.HUBSPOT_TOKEN },
            body: JSON.stringify({
              properties: {
                hs_note_body: 'Lead Type: ' + laneLabel + '\n\nConversation:\n' + convo,
                hs_timestamp: Date.now().toString()
              },
              associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }]
            })
          });

          if (isUrgent) {
            await fetch('https://api.hubapi.com/crm/v3/objects/tasks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.HUBSPOT_TOKEN },
              body: JSON.stringify({
                properties: {
                  hs_task_subject: 'URGENT - Out of Gas: ' + (leadData.name || 'New Lead'),
                  hs_task_body: 'Customer out of gas. Immediate callback required.',
                  hs_timestamp: Date.now().toString(),
                  hs_due_date: (Date.now() + 2 * 60 * 60 * 1000).toString(),
                  hs_task_priority: 'HIGH',
                  hs_task_status: 'NOT_STARTED'
                },
                associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 216 }] }]
              })
            });
          } else if (!isCommercial) {
            const due48 = Date.now() + 48 * 60 * 60 * 1000;
            await fetch('https://api.hubapi.com/crm/v3/objects/tasks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.HUBSPOT_TOKEN },
              body: JSON.stringify({
                properties: {
                  hs_task_subject: 'Follow up: ' + (leadData.name || 'New Lead'),
                  hs_task_body: 'Follow up 48 hours after sending proposal.',
                  hs_timestamp: Date.now().toString(),
                  hs_due_date: due48.toString(),
                  hs_task_priority: 'MEDIUM',
                  hs_task_status: 'NOT_STARTED'
                },
                associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 216 }] }]
              })
            });
          }
          hubspotResult = { contactId, lane: laneLabel };
        }
      } catch (hsErr) {
        console.error('HubSpot error:', hsErr.message);
      }
    }

    const cleanText = text.replace(/LEAD_CAPTURED_URGENT|LEAD_CAPTURED_COMMERCIAL|LEAD_CAPTURED/g, '').trim();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleanText, hubspot: hubspotResult })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};