import { AppError } from "../errors.js";

/** Guard for the web write path: the project must exist and not be loop-owned. */
export function assertWebEditable(projectSnap: FirebaseFirestore.DocumentSnapshot): void {
  if (!projectSnap.exists) throw new AppError(404, "not_found", "project does not exist");
  if (projectSnap.data()?.visionOwner === "loop") {
    throw new AppError(409, "conflict", "project is loop-owned (read-only in the web)");
  }
}
