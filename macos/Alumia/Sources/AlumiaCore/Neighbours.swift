// The other computers with Alumia: who is asked, and how.
//
// A local-network announcement does not cross Tailscale, and Tailscale's own
// discovery of services wants a device tagged by an administrator, which a
// personal Mac is not. So the others are found among the devices of the network:
// each one that is on, and is neither this Mac nor a phone or a tablet, is asked
// over `https` whether it is an Alumia (`GET /api/announce`, which any gateway
// answers without a login, with its version and its computer's name).
//
// The gateway runs this when the page asks for its list (`Alumia --discover`,
// src/app.rs), within a few seconds and with no window: it works with the menu
// bar item hidden.

import Foundation

/// Another computer with Alumia, as the page's list shows it.
public struct Neighbour: Codable, Sendable, Equatable {
    /// What that computer calls itself.
    public var name: String
    /// Where its own Alumia is.
    public var url: String

    public init(name: String, url: String) {
        self.name = name
        self.url = url
    }
}

public enum Neighbours {
    /// What a phone or a tablet says its system is. Neither hosts an Alumia.
    static let handheld: Set<String> = ["ios", "android", "tvos"]

    /// The devices worth asking: on, with a name to reach them by, not this Mac,
    /// and not a phone or a tablet.
    public static func candidates(in status: TailscaleStatus) -> [TailscaleDevice] {
        status.peers.filter { device in
            device.online
                && !device.address.isEmpty
                && device.address != status.own?.address
                && !handheld.contains(device.os.lowercased())
        }
    }

    /// Where a device's Alumia would be: the address its Tailscale publishes.
    public static func address(of device: TailscaleDevice) -> URL? {
        URL(string: "https://\(device.address)")
    }

    /// What a gateway says of itself.
    struct Announcement: Decodable {
        var version: String
        var name: String?
    }

    /// The neighbour an answer to `/api/announce` makes of `device`, at `address`,
    /// or `nil` where the answer is not an Alumia's. A gateway whose system does
    /// not say its computer's name is called what its device is.
    static func neighbour(_ device: TailscaleDevice, at address: URL, answered body: Data, status: Int) -> Neighbour? {
        guard status == 200,
              let said = try? JSONDecoder().decode(Announcement.self, from: body),
              !said.version.isEmpty
        else { return nil }
        let name = said.name.flatMap { $0.isEmpty ? nil : $0 } ?? device.hostName
        return Neighbour(name: name.isEmpty ? device.address : name, url: address.absoluteString)
    }

    /// Ask each of `devices` whether it is an Alumia, all at once, each given
    /// `limit` and no longer: one that does not answer delays nobody. `address`
    /// is where a device is asked, which a test points at a server of its own.
    public static func discover(
        among devices: [TailscaleDevice],
        limit: TimeInterval,
        address: @escaping @Sendable (TailscaleDevice) -> URL? = Neighbours.address(of:)
    ) async -> [Neighbour] {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = limit
        configuration.timeoutIntervalForResource = limit
        configuration.waitsForConnectivity = false
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }

        let found = await withTaskGroup(of: (Int, Neighbour?).self) { asking in
            for (place, device) in devices.enumerated() {
                asking.addTask {
                    guard let base = address(device) else { return (place, nil) }
                    let asked = base.appendingPathComponent("api/announce")
                    guard let (body, response) = try? await session.data(from: asked),
                          let status = (response as? HTTPURLResponse)?.statusCode
                    else { return (place, nil) }
                    return (place, neighbour(device, at: base, answered: body, status: status))
                }
            }
            var answers: [(Int, Neighbour)] = []
            for await (place, neighbour) in asking {
                if let neighbour {
                    answers.append((place, neighbour))
                }
            }
            return answers
        }
        // In the order the devices were given, whoever answered first.
        return found.sorted { $0.0 < $1.0 }.map(\.1)
    }

    /// What `Alumia --discover` prints: the list as JSON, which the gateway holds
    /// to a name and an `https` address before any of it reaches a page.
    public static func printed(_ neighbours: [Neighbour]) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return (try? encoder.encode(neighbours)).map { String(decoding: $0, as: UTF8.self) } ?? "[]"
    }
}
