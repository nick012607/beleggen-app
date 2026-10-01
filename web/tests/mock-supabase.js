// Nep-Supabase voor de UI-testpagina: altijd ingelogd, geen netwerk.
export const configured = true;
const session = { user: { id: '00000000-0000-0000-0000-000000000001', email: 'test@voorbeeld.nl' } };
export const supabase = {
  auth: {
    getSession: async () => ({ data: { session } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => {},
  },
};
