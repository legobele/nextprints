// Firebase singletons — every page imports auth/db/storage from here.
// (firebase-config.js is the only file that holds your API keys.)

import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { firebaseConfig } from "./firebase-config.js";

// True once real keys have been pasted into firebase-config.js.
// Pages show a friendly "not configured yet" banner when false.
export const FIREBASE_CONFIGURED =
  firebaseConfig.apiKey !== "PASTE_API_KEY" && !!firebaseConfig.projectId;

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;
