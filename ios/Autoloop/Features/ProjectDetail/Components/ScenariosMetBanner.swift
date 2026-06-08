import SwiftUI

/// Mirrors ScenariosMetBanner.tsx: shows "X / Y scenarios met",
/// with a green highlight when all scenarios are met.
struct ScenariosMetBanner: View {
    let met: Int
    let total: Int

    private var allMet: Bool { total > 0 && met == total }

    var body: some View {
        HStack {
            Text("\(met) / \(total)")
                .font(.headline.monospacedDigit())
            Text("scenarios met")
                .font(.subheadline)
                .foregroundStyle(allMet ? .white.opacity(0.85) : .secondary)
            Spacer()
        }
        .padding()
        .background(allMet ? Color.green : Color(.systemGray6))
        .foregroundStyle(allMet ? .white : .primary)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal)
    }
}
