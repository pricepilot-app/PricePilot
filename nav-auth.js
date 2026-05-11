import { auth } from './firebase.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

function setVisible(el, visible, displayValue = '') {
    if (!el) return;
    el.style.display = visible ? displayValue : 'none';
}

function stashOriginal(el, attrs) {
    if (!el) return;
    attrs.forEach((attr) => {
        const key = `orig${attr[0].toUpperCase()}${attr.slice(1)}`;
        if (el.dataset[key] != null) return;
        if (attr === 'href') el.dataset[key] = el.getAttribute('href') ?? '';
        else if (attr === 'html') el.dataset[key] = el.innerHTML;
    });
}

function restoreOriginal(el, attrs) {
    if (!el) return;
    attrs.forEach((attr) => {
        const key = `orig${attr[0].toUpperCase()}${attr.slice(1)}`;
        const val = el.dataset[key];
        if (val == null) return;
        if (attr === 'href') el.setAttribute('href', val);
        else if (attr === 'html') el.innerHTML = val;
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const navLogin = document.querySelector('.nav-login');
    const navSignup = document.querySelector('.nav-signup');
    const navLogout = document.getElementById('logout-btn');

    if (navLogout) {
        navLogout.addEventListener('click', async () => {
            localStorage.removeItem('pp_authed_hint');
            await signOut(auth);
            window.location.href = 'login.html';
        });
    }

    let loggedOutRevealTimer = null;

    const applyAuthedUI = () => {
        if (loggedOutRevealTimer) clearTimeout(loggedOutRevealTimer);
        loggedOutRevealTimer = null;

        document.querySelectorAll('a[href="login.html"]').forEach(btn => {
            const t = btn.textContent.trim();
            if (t === 'Log in') {
                btn.style.display = 'none';
                return;
            }

            if (btn.classList.contains('nav-cta')) {
                stashOriginal(btn, ['href', 'html']);
                btn.href = 'hub.html';
                btn.innerHTML = btn.innerHTML.replace(/Get started.*/i, 'Go to products <span class="btn-arrow">→</span>');
            } else if (btn.classList.contains('btn-primary')) {
                stashOriginal(btn, ['href']);
                btn.href = 'hub.html';
            }
        });

        setVisible(navLogin, false);
        setVisible(navSignup, false);
        setVisible(navLogout, true, 'inline-flex');
    };

    const applyLoggedOutUI = () => {
        // Restore any previous "authed" mutations on CTAs.
        document.querySelectorAll('a.nav-cta, a.btn-primary').forEach(btn => {
            restoreOriginal(btn, ['href', 'html']);
            if (btn.textContent.trim() === 'Log in') btn.style.display = '';
        });

        setVisible(navLogin, true);
        setVisible(navSignup, true);
        setVisible(navLogout, false);
    };

    // Fast-path: if we were authed on the previous page view, render the authed navbar immediately
    // to avoid a flicker during navigation while Firebase restores state.
    const authedHint = localStorage.getItem('pp_authed_hint') === '1';
    if (authedHint) applyAuthedUI();
    else applyLoggedOutUI();

    onAuthStateChanged(auth, (user) => {
        const authed = !!user;
        if (authed) {
            localStorage.setItem('pp_authed_hint', '1');
            applyAuthedUI();
            return;
        }

        localStorage.removeItem('pp_authed_hint');

        // If the first callback is `null` but a user appears shortly after (common on refresh),
        // delaying avoids a visible "logged-out" flash.
        if (authedHint) {
            // We optimistically rendered the authed navbar; if that's wrong, correct immediately.
            applyLoggedOutUI();
            return;
        }
        if (loggedOutRevealTimer) clearTimeout(loggedOutRevealTimer);
        loggedOutRevealTimer = setTimeout(applyLoggedOutUI, 150);
    });
});
