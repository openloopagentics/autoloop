import { onRequest } from "firebase-functions/v2/https";
import { makeApp } from "./app.js";

export const api = onRequest({ cors: false }, makeApp());

export { onScoreWritten, onTestRunWritten, onProjectStatusWritten } from "./notify/trigger.js";
