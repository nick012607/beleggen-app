// Publieke Supabase-instellingen. De anon key is bedoeld om publiek te zijn:
// de beveiliging zit in Row Level Security. Zet hier NOOIT de service_role key.
// Te vinden in Supabase: Project Settings -> API (Project URL en anon/publishable key).
export const SUPABASE_URL = 'https://sqdciwujimgctdlxtsvi.supabase.co';
// Adres van de Cloudflare Worker (koersen, krant). Wordt ingevuld na `wrangler deploy`.
export const WORKER_URL = '';
export const SUPABASE_ANON_KEY = 'sb_publishable_GaClOcaJ1abZH9-Z-SyJTw_mEdl20QZ';
