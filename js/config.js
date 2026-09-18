// ============================================================
// ESS Fitness Center - config
// Fill in YOUR Supabase project details below.
// Find them at: Supabase Dashboard > Project Settings > API
// ============================================================
var SUPABASE_URL = 'https://smzywhuujufsprgsqfyo.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtenl3aHV1anVmc3ByZ3NxZnlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzOTQ1MDYsImV4cCI6MjEwNDk3MDUwNn0.HUontpvxhhxPVFIhkeM4SoXml2KsV2ANs5zhz8qjs6U';

// Merchant PromptPay number used to generate payment QR codes.
//  - 10-digit mobile number   e.g. '0961234567'
//  - 13-digit tax / national ID
// NOTE: The value shown on the payment page is read from the
// supabase `settings` table (key = 'promptpay_id'), so an admin
// can edit it without touching code. This value is only the
// fallback used if the table has no entry.
var DEFAULT_PROMPTPAY_ID = '0643453115';

var APP_NAME = 'ESS Fitness Center';
var APP_SHORT_NAME = 'ESS Fitness';