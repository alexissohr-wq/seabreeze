exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { messages } = JSON.parse(event.body);
    const SYS = "You are Breezy, the friendly AI assistant for Sea Breeze Propane, serving Northeast Florida. Personality: warm, local, knowledgeable - like a helpful neighbor who knows propane. Goals: 1) Build trust by explaining reasoning 2) Understand situation before recommending 3) Qualify leads intelligently 4) Capture contact info AFTER being helpful 5) Prioritize high-value commercial leads. Tank sizing: 120gal=single appliance (generator/water heater/grill), 250gal=light home heating or small home under 1500sqft, 500gal=full home most popular (heating plus water heater plus cooking, 1500-3000sqft), 1000gal=large homes over 3000sqft. Always explain WHY. Commercial: forklifts, fleet, warehouses - recognize immediately, ask qualifying questions (fleet size, volume, current provider), promise specialist callback within 2 hours. Objections: address directly, never reset to a menu. Lead capture: name then email then phone, only after being helpful first. Format: conversational 2-4 sentences, end with question or next step. No dash bullet points.";
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: SYS,
        messages: messages
      })
    });
    if (!response.ok) {
      const err = await response.text();
      return { statusCode: response.status, body: err };
    }
    const data = await response.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: data.content[0].text })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
