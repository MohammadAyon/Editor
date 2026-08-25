// src/auth-ui.js — Auth gate and shell display logic
import { db } from './data/supabase-client.js';

export function showAuthGate(){
  document.getElementById('authGate').style.display = 'flex';
  document.getElementById('appShell').style.display = 'none';
}

export function showAppShell(session){
  document.getElementById('authGate').style.display = 'none';
  document.getElementById('appShell').style.display = '';
  const emailLabel = document.getElementById('authUserEmail');
  if(emailLabel) emailLabel.textContent = (session && session.user && session.user.email) || '';
}

export async function handleSignIn(){
  const errorEl = document.getElementById('authError');
  const button = document.getElementById('authSubmitBtn');
  errorEl.textContent = '';
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  if(!email || !password){ errorEl.textContent = 'Enter your email and password.'; return; }
  button.disabled = true;
  button.textContent = 'Signing in...';
  const { error } = await db.auth.signInWithPassword({ email, password });
  button.disabled = false;
  button.textContent = 'Sign in';
  if(error) errorEl.textContent = error.message;
}

export async function handleSignOut(){
  if(db) await db.auth.signOut();
}
