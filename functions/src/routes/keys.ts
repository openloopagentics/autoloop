import { Router } from "express";
import { AppError } from "../errors.js";
import { keyMintBody } from "../schemas.js";
import { mintKey, listKeys, revokeKey } from "../services/apiKeys.js";

export const keysRouter = Router();

keysRouter.post("/", async (req, res, next) => {
  try {
    const uid = req.uid!; // set by requireUser
    const parsed = keyMintBody.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "validation", parsed.error.issues[0].message);
    res.status(201).json(await mintKey(uid, parsed.data.label));
  } catch (err) {
    next(err);
  }
});

keysRouter.get("/", async (req, res, next) => {
  try {
    res.status(200).json({ keys: await listKeys(req.uid!) });
  } catch (err) {
    next(err);
  }
});

keysRouter.delete("/:id", async (req, res, next) => {
  try {
    await revokeKey(req.uid!, req.params.id);
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
