import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { makeApp } from "./app.js";

// In production, write keys come from a Functions secret; locally from .env / process.env.
const writeKeys = defineSecret("DALOOP_WRITE_KEYS");

export const api = onRequest({ secrets: [writeKeys], cors: false }, makeApp());
