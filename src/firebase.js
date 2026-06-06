import { initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth, signInWithPopup, signOut } from "firebase/auth";
import {
    addDoc,
    collection,
    connectFirestoreEmulator,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    getFirestore,
    limit,
    query,
    runTransaction,
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
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const useFirestoreEmulator = import.meta.env.VITE_USE_FIRESTORE_EMULATOR === "true";
const firestoreEmulatorHost = import.meta.env.VITE_FIREBASE_FIRESTORE_EMULATOR_HOST || "127.0.0.1";
const firestoreEmulatorPort = Number(import.meta.env.VITE_FIREBASE_FIRESTORE_EMULATOR_PORT || 8080);

export const hasFirebaseConfig = [
  firebaseConfig.apiKey,
  firebaseConfig.authDomain,
  firebaseConfig.projectId,
  firebaseConfig.storageBucket,
  firebaseConfig.messagingSenderId,
  firebaseConfig.appId,
].every(Boolean);
export const initialAdminEmail = import.meta.env.VITE_INITIAL_ADMIN_EMAIL?.toLowerCase().trim() || "";

export const app = hasFirebaseConfig ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

if (db && useFirestoreEmulator) {
  connectFirestoreEmulator(db, firestoreEmulatorHost, firestoreEmulatorPort);
}

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

export function memberDocId(messId, email) {
  return `${messId}_${email.toLowerCase()}`;
}

export async function getMemberships(email) {
  const normalizedEmail = email.toLowerCase();
  const snap = await getDocs(query(collection(db, "members"), where("email", "==", normalizedEmail)));
  return snap.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.active);
}

export async function getMess(messId) {
  if (!messId) return null;
  const snap = await getDoc(doc(db, "messes", messId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createMess({ name, user }) {
  const email = user.email.toLowerCase();
  const messRef = doc(collection(db, "messes"));
  const memberRef = doc(db, "members", memberDocId(messRef.id, email));
  const mess = {
    name: name || "My Mess",
    createdBy: email,
    createdByName: user.displayName || email,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const member = {
    messId: messRef.id,
    messName: mess.name,
    name: user.displayName || email,
    email,
    role: "admin",
    active: true,
    joinedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(messRef, mess);
  await setDoc(memberRef, member);
  return { mess: { id: messRef.id, ...mess }, member: { id: memberRef.id, ...member } };
}

export async function createInvite({ messId, messName, role, createdBy }) {
  if (!messId) throw new Error("No mess selected. Please reload the app or select a mess first.");
  const inviteRef = doc(collection(db, "invites"));
  const invite = {
    messId,
    role,
    used: false,
    createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (messName) invite.messName = messName;
  await setDoc(inviteRef, invite);
  return inviteRef.id;
}

export async function joinInvite({ token, user }) {
  const email = user.email.toLowerCase();
  const inviteRef = doc(db, "invites", token);
  return runTransaction(db, async (transaction) => {
    const inviteSnap = await transaction.get(inviteRef);
    if (!inviteSnap.exists()) throw new Error("Invite link is invalid.");
    const invite = inviteSnap.data();
    if (invite.used) throw new Error("This invite link has already been used.");

    const memberRef = doc(db, "members", memberDocId(invite.messId, email));
    const member = {
      messId: invite.messId,
      messName: invite.messName || "",
      name: user.displayName || email,
      email,
      role: invite.role === "admin" ? "admin" : "member",
      active: true,
      inviteId: token,
      joinedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    transaction.set(memberRef, member, { merge: true });
    transaction.update(inviteRef, {
      used: true,
      usedBy: email,
      usedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return { id: memberRef.id, ...member };
  });
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

export async function getOpenCycle(messId) {
  const filters = [where("status", "==", "open")];
  if (messId) filters.push(where("messId", "==", messId));
  const snap = await getDocs(query(collection(db, "cycles"), ...filters, limit(1)));
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
