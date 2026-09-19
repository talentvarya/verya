const form = document.getElementById('authForm');
const loginTab = document.getElementById('loginTab');
const signupTab = document.getElementById('signupTab');
const formTitle = document.getElementById('formTitle');
const submitButton = document.getElementById('submitButton');
const message = document.getElementById('message');
let mode = 'login';

function setMode(next) {
  mode = next;
  const signup = mode === 'signup';
  loginTab.classList.toggle('active', !signup);
  signupTab.classList.toggle('active', signup);
  formTitle.textContent = signup ? 'Create your fleet account' : 'Sign in to your fleet';
  submitButton.textContent = signup ? 'Create account' : 'Sign in';
  document.getElementById('password').autocomplete = signup ? 'new-password' : 'current-password';
  message.textContent = '';
  message.className = 'message';
}
loginTab.addEventListener('click', () => setMode('login'));
signupTab.addEventListener('click', () => setMode('signup'));

form.addEventListener('submit', async event => {
  event.preventDefault();
  message.textContent = '';
  submitButton.disabled = true;
  const payload = { email: document.getElementById('email').value.trim(), password: document.getElementById('password').value };
  try {
    const response = await fetch(`/api/auth/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Authentication failed.');
    if (mode === 'signup' && result.requiresEmailConfirmation) {
      message.textContent = 'Account created. Confirm your email, then sign in.';
      message.className = 'message success';
      setMode('login');
      document.getElementById('email').value = payload.email;
      return;
    }
    const next = new URLSearchParams(window.location.search).get('next') || '/';
    window.location.href = next.startsWith('/') ? next : '/';
  } catch (error) { message.textContent = error.message; }
  finally { submitButton.disabled = false; }
});
