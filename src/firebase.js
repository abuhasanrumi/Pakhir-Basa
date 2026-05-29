import { initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth, signInWithPopup, signOut } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const hasFirebaseConfig = Object.values(firebaseConfig).every(Boolean);
export const initialAdminEmail = import.meta.env.VITE_INITIAL_ADMIN_EMAIL?.toLowerCase().trim() || "";

const app = hasFirebaseConfig ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

export async function signInWithGoogle() {
  if (!auth) throw new Error("Firebase is not configured.");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(auth, provider);
}

export async function signOutUser() {
  if (!auth) return;
  return signOut(auth);
}

export async function getMemberByEmail(email) {
  const normalizedEmail = email.toLowerCase();
  const snap = await getDoc(doc(db, "members", normalizedEmail));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function bootstrapAdmin(user) {
  const email = user.email.toLowerCase();
  const memberRef = doc(db, "members", email);
  await setDoc(memberRef, {
    name: user.displayName || user.email,
    email,
    role: "admin",
    active: true,
    createdAt: serverTimestamp(),
  });
  return { id: memberRef.id, name: user.displayName || user.email, email, role: "admin", active: true };
}

export async function getOpenCycle() {
  const snap = await getDocs(query(collection(db, "cycles"), where("status", "==", "open"), limit(1)));
  if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  return null;
}

export function addRecord(collectionName, data) {
  return addDoc(collection(db, collectionName), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
}

export function setRecord(collectionName, id, data) {
  return setDoc(doc(db, collectionName, id), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

export function updateRecord(collectionName, id, data) {
  return updateDoc(doc(db, collectionName, id), { ...data, updatedAt: serverTimestamp() });
}

export function deleteRecord(collectionName, id) {
  return deleteDoc(doc(db, collectionName, id));
}
