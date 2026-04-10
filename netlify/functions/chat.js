exports.handler = async function(event) {
  const token = process.env.HUBSPOT_TOKEN;
  const r = await fetch('https://api.hubapi.com/crm/v3/owners?limit=100', { headers: { 'Authorization': 'Bearer ' + token } });
  const d = await r.json();
  const owners = (d.results || []).map(function(o) { return o.id + ' | ' + o.firstName + ' ' + o.lastName + ' | ' + o.email; }).join('\n');
  console.log('OWNERS:\n' + owners);
  return { statusCode: 200, body: JSON.stringify({ owners: owners }) };
};