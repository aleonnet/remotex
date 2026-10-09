// Alumia stopped and started by its owner: the menu's two items and the General
// pane's switch ask the gateway, by a command each, and ask nothing of the
// service. A gateway that is stopped is the same service, registered and
// answering, and it is left as it is; a Mac that is set up has its service
// registered whatever its owner chose, since nothing that is read carries the
// choice.

import XCTest
@testable import AlumiaCore

final class PowerTests: XCTestCase {
    private let binary = URL(fileURLWithPath: "/Applications/Alumia.app/Contents/Helpers/alumia")

    func testStoppingAndStartingAreEachOneCommandOfTheGateways() async {
        let runner = Scripted([Ran(status: 0, output: "{\"stopped\":true}"), Ran(status: 0, output: "{\"stopped\":false}")])
        let gateway = Gateway(binary: binary, runner: runner, language: .portuguese)
        let stopped = await gateway.stop()
        XCTAssertNotNil(stopped.success)
        XCTAssertEqual(runner.asked.map(\.arguments), [["app", "--language", "pt-BR", "stop"]])
        let started = await gateway.start()
        XCTAssertNotNil(started.success)
        XCTAssertEqual(runner.asked.map(\.arguments), [
            ["app", "--language", "pt-BR", "stop"], ["app", "--language", "pt-BR", "start"],
        ])
    }

    func testAGatewayThatCouldNotBeToldSaysSo() async {
        let refused = "{\"refused\":{\"code\":\"AL-9905\",\"says\":\"Não foi possível gravar.\",\"detail\":\"read-only\"}}"
        let gateway = Gateway(binary: binary, runner: Scripted([Ran(status: 1, output: refused)]), language: .portuguese)
        let stopped = await gateway.stop()
        XCTAssertEqual(stopped.failure?.code, "AL-9905")
    }

    func testAStoppedGatewayAnswersAndItsServiceIsLeftAsItIs() {
        // Stopped, the gateway still answers on its control socket: the service is
        // running, whatever the system says of it, and nothing is done to it.
        var policy = RegistrationPolicy()
        for registration in Registration.allCases {
            let reading = ServiceReading(registration: registration, answering: true)
            let state = ServiceState.of(reading, silentFor: 600)
            XCTAssertEqual(policy.next(state: state, answering: true), [], "\(registration)")
        }
        XCTAssertEqual(policy.attempts, 0)
        XCTAssertEqual(
            ServiceState.of(ServiceReading(registration: .enabled, answering: true), silentFor: 600),
            .running
        )
    }

    func testAMacThatIsSetUpHasItsServiceRegisteredWhateverWasChosen() {
        // Nothing read of the service says on or stopped, so nothing decided
        // from it can depend on that: a service that is not registered is
        // registered, and no state there is means "off by choice".
        var policy = RegistrationPolicy()
        let reading = ServiceReading(registration: .notRegistered, answering: false)
        XCTAssertEqual(policy.next(state: ServiceState.of(reading, silentFor: 0), answering: false), [.register])
        XCTAssertEqual(
            Set(ServiceState.allCases),
            [.notRegistered, .running, .registeredButSilent, .needsApproval, .notFound]
        )
    }
}
