import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

// Configuration web Firebase (identifiants publics par nature : la sécurité repose sur les règles et l'authentification)
const firebaseConfig = {
  apiKey: "AIzaSyDp8JsIN3bFG9Ityue275-hRL4RZ-AR1P8",
  authDomain: "inspectionbat.firebaseapp.com",
  projectId: "inspectionbat",
  storageBucket: "inspectionbat.firebasestorage.app",
  messagingSenderId: "922401768028",
  appId: "1:922401768028:web:2030279138ef656ed79c99",
  measurementId: "G-8L6QQK2RR0"
};

export const isFirebaseConfigured = true;

const app = initializeApp(firebaseConfig);

// App Check (facultatif) : protège la fonction IA contre les appels hors de l'application.
// Activer : créer une clé reCAPTCHA Enterprise, la mettre dans VITE_RECAPTCHA_SITE_KEY, puis ENFORCE_APP_CHECK=true côté fonctions.
const recaptchaKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined;
if (recaptchaKey) {
  initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(recaptchaKey), isTokenAutoRefreshEnabled: true });
}

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

// Fonction serveur IA déployée à Zurich (même région que dans functions/src/index.ts)
export const functions = getFunctions(app, "europe-west6");
if (import.meta.env.VITE_USE_EMULATORS === "1") {
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
