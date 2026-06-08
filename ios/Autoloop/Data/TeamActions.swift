import Foundation
import FirebaseAuth
import FirebaseFirestore

/// Ports web/src/teams/actions.ts.
enum TeamActions {
    private static var db: Firestore { Firestore.firestore() }

    /// Bootstrap: create the team, then (sequential) the creator's own owner member.
    static func createTeam(teamId: String, name: String) async throws {
        guard let user = Auth.auth().currentUser else { throw ApiError(message: "Not signed in") }
        let uid = user.uid
        let email = user.email?.lowercased()
        try await db.collection("teams").document(teamId).setData([
            "name": name, "createdBy": uid, "createdAt": FieldValue.serverTimestamp(),
        ])
        try await db.collection("teams").document(teamId)
            .collection("members").document(uid).setData([
                "uid": uid, "role": "owner", "email": email as Any? ?? NSNull(),
                "inviteId": NSNull(), "joinedAt": FieldValue.serverTimestamp(),
            ])
    }

    static func inviteMember(teamId: String, email: String, role: Role) async throws {
        guard let uid = Auth.auth().currentUser?.uid else { throw ApiError(message: "Not signed in") }
        _ = try await db.collection("teams").document(teamId).collection("invites").addDocument(data: [
            "email": email.lowercased(), "role": role.rawValue, "invitedBy": uid,
            "status": "pending", "createdAt": FieldValue.serverTimestamp(),
        ])
    }

    static func revokeInvite(teamId: String, inviteId: String) async throws {
        try await db.collection("teams").document(teamId)
            .collection("invites").document(inviteId).delete()
    }

    /// Atomic accept: create own member (carrying inviteId) + delete the invite.
    static func acceptInvite(_ invite: Invite) async throws {
        guard let uid = Auth.auth().currentUser?.uid else { throw ApiError(message: "Not signed in") }
        guard let teamId = invite.teamId else { throw ApiError(message: "Invite missing teamId") }
        let batch = db.batch()
        let memberRef = db.collection("teams").document(teamId).collection("members").document(uid)
        batch.setData([
            "uid": uid, "role": invite.role.rawValue, "email": invite.email.lowercased(),
            "inviteId": invite.id, "joinedAt": FieldValue.serverTimestamp(),
        ], forDocument: memberRef)
        let inviteRef = db.collection("teams").document(teamId).collection("invites").document(invite.id)
        batch.deleteDocument(inviteRef)
        try await batch.commit()
    }

    static func declineInvite(_ invite: Invite) async throws {
        guard let teamId = invite.teamId else { throw ApiError(message: "Invite missing teamId") }
        try await db.collection("teams").document(teamId)
            .collection("invites").document(invite.id).delete()
    }

    static func changeRole(teamId: String, uid: String, role: Role) async throws {
        try await db.collection("teams").document(teamId)
            .collection("members").document(uid).updateData(["role": role.rawValue])
    }

    static func removeMember(teamId: String, uid: String) async throws {
        try await db.collection("teams").document(teamId)
            .collection("members").document(uid).delete()
    }
}
