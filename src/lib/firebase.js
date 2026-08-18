import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBmFbOWy-aMCwJJlzVytvqdc3itDaRH2b4",
  authDomain: "egifinanceiro.firebaseapp.com",
  projectId: "egifinanceiro",
  storageBucket: "egifinanceiro.firebasestorage.app",
  messagingSenderId: "705289484628",
  appId: "1:705289484628:web:8ebfab46447178f6c2f0c1",
  measurementId: "G-9426T5VST7",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
