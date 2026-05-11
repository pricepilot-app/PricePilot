import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyD8SUZSh4iFSY0CGjeBTQcZ1qobe-VRvTg",
    authDomain: "pricepilot-80bb6.firebaseapp.com",
    projectId: "pricepilot-80bb6",
    storageBucket: "pricepilot-80bb6.firebasestorage.app",
    messagingSenderId: "332253872986",
    appId: "1:332253872986:web:e928f66ab9dddf3b84a963"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
