import Foundation
import SystemConfiguration
import Security

// Fixed stdin JSON protocol. No shell commands and no elevated daemon.
struct Failure: Error { let message: String }
func fail(_ text: String) throws -> Never { throw Failure(message: text) }
func check(_ result: Bool) throws { if !result { try fail(String(cString: SCErrorString(SCError()))) } }
func snapshot(_ prefs: SCPreferences) throws -> [[String: Any]] {
    guard let set = SCNetworkSetCopyCurrent(prefs), let current = SCNetworkSetCopyServices(set) as? [SCNetworkService], let services = SCNetworkServiceCopyAll(prefs) as? [SCNetworkService] else { try fail("No network services") }
    let active = Set(current.compactMap { SCNetworkServiceGetServiceID($0) as String? })
    return services.compactMap { service in
        guard let proto = SCNetworkServiceCopyProtocol(service, kSCNetworkProtocolTypeProxies) else { return nil }
        return ["id": SCNetworkServiceGetServiceID(service)! as String, "active": active.contains(SCNetworkServiceGetServiceID(service)! as String), "serviceEnabled": SCNetworkServiceGetEnabled(service), "name": (SCNetworkServiceGetName(service) as String?) ?? "Network", "enabled": SCNetworkProtocolGetEnabled(proto), "config": (SCNetworkProtocolGetConfiguration(proto) as? [String: Any]).map { $0 as Any } ?? NSNull()]
    }
}
do {
    let bytes = FileHandle.standardInput.readDataToEndOfFile()
    if bytes.count > 2_000_000 { try fail("Input exceeds limit") }
    guard let input = try JSONSerialization.jsonObject(with: bytes) as? [String: Any], let command = input["command"] as? String, ["read", "write"].contains(command) else { try fail("Invalid command") }
    var auth: AuthorizationRef?
    if command == "write" {
        let status = AuthorizationCreate(nil, nil, [.interactionAllowed, .extendRights, .preAuthorize], &auth)
        if status != errAuthorizationSuccess { try fail("macOS authorization was not granted") }
    }
    defer { if let auth = auth { AuthorizationFree(auth, []) } }
    guard let prefs = SCPreferencesCreateWithAuthorization(nil, "THUGSred Glasses proxy toggle" as CFString, nil, auth) else { try fail("Unable to open network preferences") }
    if command == "read" {
        let output = try JSONSerialization.data(withJSONObject: ["services": try snapshot(prefs)])
        FileHandle.standardOutput.write(output)
    } else {
        guard let changes = input["changes"] as? [[String: Any]], changes.count > 0, changes.count <= 100 else { try fail("Invalid changes") }
        try check(SCPreferencesLock(prefs, false))
        defer { SCPreferencesUnlock(prefs) }
        var pending: [(SCNetworkProtocol, [String: Any], Bool)] = []
        for change in changes {
            guard let id = change["id"] as? String, let expected = change["expected"] as? [String: Any], let desired = change["desired"] as? [String: Any], let enabled = desired["enabled"] as? Bool,
                let service = SCNetworkServiceCopy(prefs, id as CFString), let proto = SCNetworkServiceCopyProtocol(service, kSCNetworkProtocolTypeProxies) else { try fail("Network service disappeared") }
            let current: [String: Any] = ["enabled": SCNetworkProtocolGetEnabled(proto), "config": (SCNetworkProtocolGetConfiguration(proto) as? [String: Any]).map { $0 as Any } ?? NSNull()]
            if !NSDictionary(dictionary: current).isEqual(to: expected) { try fail("Network settings changed outside Glasses; no settings were overwritten") }
            guard desired["config"] is NSNull || desired["config"] is [String: Any] else { try fail("Invalid proxy configuration") }
            pending.append((proto, desired, enabled))
        }
        for (proto, desired, enabled) in pending {
            try check(SCNetworkProtocolSetConfiguration(proto, (desired["config"] as? [String: Any]).map { $0 as CFDictionary }))
            try check(SCNetworkProtocolSetEnabled(proto, enabled))
        }
        try check(SCPreferencesCommitChanges(prefs))
        try check(SCPreferencesApplyChanges(prefs))
        FileHandle.standardOutput.write(Data("{\"ok\":true}".utf8))
    }
} catch {
    let message = (error as? Failure)?.message ?? "Network proxy operation failed"
    let output = try! JSONSerialization.data(withJSONObject: ["error": message])
    FileHandle.standardOutput.write(output)
    exit(1)
}
