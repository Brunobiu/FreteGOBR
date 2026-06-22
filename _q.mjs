const token = process.env.SBP_TOKEN;
const sql = process.argv[2];
const res = await fetch(`https://api.supabase.com/v1/projects/kvdwmgchtpdnllxwswtf/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
console.log(`HTTP ${res.status}`);
console.log(await res.text());
