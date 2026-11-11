# covers: src/js/presenter.js, src/js/presenter/ShellJoin.js, src/js/presenter/statusText.js,src/js/presenter/shellLink.js, src/js/presenter/panels/ConnectionPanel.js, src/templates/presenter.html, src/templates/sw.js, src/shell/manifest.webmanifest, gulpfile.js
Feature: The presenter as a hosted shell that joins a talk from a link

  The shell is the presenter page as static files, which any host can serve under any path.
  A person opens a pairing link on a phone or a laptop: the previews load the published deck,
  and the frame counter, the notes and the previews follow the talk. Two devices on one link
  both follow, and either can move the talk. The shell opens no audience window.

  The shell can be installed. Opened offline or with no link, it shows the workspace with a
  notice that says it is not connected or reconnecting, never a browser error. A link whose deck is not a web
  address is refused.

  The "relay" deck is the two frames of "basic" with the display's end of a stand-in relay. The
  host's addons.js is the other end, and the two talk over a BroadcastChannel named after the
  session. The shell is served under a deep path, so an absolute URL in the build breaks every
  scenario here.

  The Connection panel names the shell's link to the talk in the same voice as the presenter's
  own: "Reconnecting" while the shell waits for the display to answer, "Connected" once it has.
  The notice bar uses the same words: "Reconnecting" and "Stale" tell the speaker the link is
  waiting, not gone. It says "Not connected" only when the link is closed, and it hides while
  the link is connected.

  Background:
    Given the "relay" deck is built and served
    And the presenter shell is served at "/talks/shell/" with the fake relay

  @issue-29
  Scenario: A pairing link joins a phone and a laptop to the same talk at once
    Given the deck page is open on the fake relay session "s1"
    When the shell is opened on a phone with the pairing link for session "s1"
    And the shell is opened on a laptop with the pairing link for session "s1"
    Then within 5 seconds the phone's frame counter reads "1 / 2"
    And within 5 seconds the laptop's frame counter reads "1 / 2"
    And every preview on the phone shows the "relay" deck
    When the next button is pressed on the phone
    Then the deck page is on frame "Two"
    And the laptop's frame counter reads "2 / 2"
    And a screenshot "shell-phone-joined" is saved

  @issue-29 @issue-431
  Scenario: The installed shell opened offline says it is reconnecting
    Given the shell has been opened once with the pairing link for session "s1"
    When the browser goes offline
    And the shell is reloaded
    Then the shell shows "Reconnecting"
    And the page title is the shell's
    And a screenshot "shell-offline" is saved

  @issue-29
  Scenario: The shell without a pairing link says how to join
    When the shell is opened without a pairing link
    Then the shell shows "Not connected"
    And the shell shows "Open a pairing link to join a talk."

  @issue-29
  Scenario: A link whose deck is not a web address is refused
    When the shell is opened with a pairing link whose deck is "javascript:alert(1)"
    Then no preview has loaded
    And the shell shows "This is not a Sozi pairing link."

  @issue-303
  Scenario: The shell says it is reconnecting until the display answers
    When the shell is opened on a laptop with the pairing link for session "s2"
    Then the "Connection" panel reads "Reconnecting"
    And a screenshot "shell-reconnecting" is saved

  @issue-303
  Scenario: The Connection panel says connected once the display answers
    Given the shell is opened on a laptop with the pairing link for session "s3"
    And the "Connection" panel reads "Reconnecting"
    When the deck page is open on the fake relay session "s3"
    Then within 5 seconds the laptop's frame counter reads "1 / 2"
    And the "Connection" panel reads "Connected"

  @issue-431
  Scenario: The notice bar names each status of the shell's link
    Given the shell is opened on a laptop with the pairing link for session "s4"
    When the shell's relay reports "stale"
    Then the shell shows "Stale"
    And a screenshot "shell-notice-stale" is saved
    When the shell's relay reports "reconnecting"
    Then the shell shows "Reconnecting"
    When the shell's relay reports "connected"
    Then the shell's notice is hidden
    When the shell's relay reports "closed"
    Then the shell shows "Not connected"

  @issue-431
  Scenario: A link that has not reached the display yet says it is reconnecting
    When the shell is opened on a laptop with the pairing link for session "s5"
    Then the shell shows "Reconnecting"
