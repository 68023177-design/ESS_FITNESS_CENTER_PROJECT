// Supabase Edge Function: send-email
// Sends a simple email via Resend. This is an OPTIONAL extra -
// the in-app notification bell works without it.
//
// Setup:
//   1. Create a Resend API key (https://resend.com) -> set as secret
//      RESEND_API_KEY  (Supabase Dashboard > Edge Functions > Secrets)
//   2. Set a shared secret:  EDGE_SECRET  (any long random string)
//   3. Deploy:  supabase functions deploy send-email
//   4. In SQL use pg_net to POST with "Authorization: Bearer <EDGE_SECRET>"
//      (see send-email/README.md for the SQL snippet)
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') || '';
const EDGE_SECRET = Deno.env.get('EDGE_SECRET') || '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: cors });
  }

  const auth = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  if (!EDGE_SECRET || auth !== EDGE_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401,
      headers: cors,
    });
  }
  if (!RESEND_KEY) {
    return new Response(
      JSON.stringify({ ok: false, error: 'RESEND_API_KEY not configured' }),
      { status: 500, headers: cors }
    );
  }

  let body: { to?: string; subject?: string; html?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'invalid json' }), {
      status: 400,
      headers: cors,
    });
  }

  const { to, subject, html } = body;
  if (!to || !subject) {
    return new Response(JSON.stringify({ ok: false, error: 'missing to/subject' }), {
      status: 400,
      headers: cors,
    });
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + RESEND_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'ESS Fitness Center <onboarding@resend.dev>',
      to: [to],
      subject: subject,
      html: html || '',
    }),
  });

  return new Response(JSON.stringify(await res.json()), {
    status: res.status,
    headers: cors,
  });
});