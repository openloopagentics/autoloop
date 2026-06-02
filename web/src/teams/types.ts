export type Role = "owner" | "admin" | "member";
export interface Member { uid: string; role: Role; email?: string; }
export interface Invite { id: string; teamId?: string; email: string; role: Role; status?: string; }
