import { Clerk } from '@clerk/clerk-js';

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!publishableKey) {
  throw new Error('VITE_CLERK_PUBLISHABLE_KEY is not set — copy .env.example to .env.local and add your Clerk publishable key.');
}

export const clerk = new Clerk(publishableKey);

let loaded = false;
export async function initAuth() {
  if (!loaded) {
    await clerk.load();
    loaded = true;
  }
  return clerk;
}
