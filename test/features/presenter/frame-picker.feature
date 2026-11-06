# covers: src/js/presenter.js, src/js/presenter/panels/FramePickerPanel.js, src/js/presenter/ThumbnailSource.js, src/js/presenter/ThumbnailCache.js, src/js/presenter/PresenterApi.js, src/js/presenter/DisplayMirror.js, src/js/presenter/Workspace.js, src/js/player.js, src/js/player/ThumbnailRenderer.js, src/js/player/DisplayChannel.js, src/js/protocol/messages.js, src/templates/presenter.html
Feature: The frame picker

  The speaker walks the room with a phone and wants to go to any frame from it. The Frames
  panel is a grid with one tile per frame, showing its thumbnail, number and title. Tapping
  a tile moves the display there, and every surface follows what the display reports: the
  picker marks a frame only once the display says it is there. Shift moves without the
  transition.

  The thumbnails fill in on their own and come back after a reload without being rendered
  again; a rebuilt deck renders them anew. Hovering a tile, focusing it or pressing it for
  a long moment shows that frame's notes, sanitised, and does not move the talk. Typing
  keeps the tiles whose title holds the text, Enter goes to the first of them and Escape
  brings the others back. Every other presentation key still drives the talk.

  Rule: The basic deck

    Background:
      Given the "basic" deck is built
      And the presenter page is open

    @issue-30
    Scenario: Tapping a frame on the phone moves the talk and every surface follows
      Given the presenter page is on a touch screen
      And a second surface is attached to the audience window
      When the presenter page is resized to 390 by 844
      And the "Frames" tab is chosen
      And the frame "Two" is tapped in the picker
      Then the audience window is on frame "Two"
      And the frame counter reads "2 / 2"
      And the second surface heard the frame "Two"
      And the picker marks the frame "Two"
      And the "Frames" panel fills the page below its tabs
      And a screenshot "frame-picker-phone" is saved

    @issue-30
    Scenario: The picker follows a move made elsewhere
      When the next button is pressed
      Then the picker marks the frame "Two"

    @issue-30
    Scenario: The picker marks a frame only when the display reports it
      Given the audience window does not answer
      When the frame "Two" is clicked in the picker
      Then the picker marks the frame "One"

    @issue-30
    Scenario: Shift jumps without the transition
      When the frame "Two" is clicked in the picker with Shift
      Then the audience window is on frame "Two" with no transition running

    @issue-30
    Scenario: Every frame gets a thumbnail of its own
      Then every tile in the picker has a thumbnail
      And the thumbnails of "One" and "Two" differ
      And the audience window stays on frame "One"
      And a screenshot "frame-picker-grid" is saved

    @issue-30
    Scenario: Thumbnails come back after a reload without rendering again
      Given every tile in the picker has a thumbnail
      When the presenter page is reloaded
      Then every tile in the picker has a thumbnail
      And no thumbnail deck was loaded

    @issue-30
    Scenario: A rebuilt deck renders its thumbnails again
      Given every tile in the picker has a thumbnail
      When the deck is rebuilt
      And the presenter page is reloaded
      Then a thumbnail deck was loaded

    @issue-30
    Scenario: A layout saved before the picker existed still shows the panel
      Given the saved layout for the deck has no "Frames" panel
      When the presenter page is reloaded
      Then the workspace shows a panel "Frames"

  Rule: With notes

    Background:
      Given the "notes" deck is built
      And the presenter page is open

    @issue-30
    Scenario: Hovering a frame shows its notes, sanitised
      When the frame "Two" is hovered in the picker
      Then the picker's notes show "Two"
      And the picker's notes hold no script and no event handler attribute
      And the audience window stays on frame "One"

    @issue-30
    Scenario: A long press shows the notes and does not jump
      Given the presenter page is on a touch screen
      When the frame "Two" is long pressed in the picker
      Then the picker's notes show "Two"
      And the audience window stays on frame "One"
      And a screenshot "frame-picker-notes" is saved

  Rule: A long deck

    Background:
      Given the "long" deck is built
      And the presenter page is open

    @issue-30
    Scenario: Typing finds a title in a 100-frame deck
      When "kube" is typed in the picker's filter
      Then the picker shows only the frame "Kubernetes"
      When the key "Enter" is pressed in the picker's filter
      Then the audience window is on frame "Kubernetes"
      And the picker marks the frame "Kubernetes"
      And the frame "Kubernetes" is in view in the picker

    @issue-30
    Scenario: Enter on a tile jumps there, and Space still drives the talk
      When the frame "Kubernetes" is focused in the picker
      And the key "Enter" is pressed on the presenter page
      Then the audience window is on frame "Kubernetes"
      When the frame "Frame 5" is clicked in the picker
      Then the audience window is on frame "Frame 5"
      When the key " " is pressed on the presenter page
      Then the audience window is on frame "Frame 6"

    @issue-30
    Scenario: A filter that matches nothing says so, and Escape brings the frames back
      When "zzz" is typed in the picker's filter
      Then the picker says "No matching frame"
      When the key "Escape" is pressed in the picker's filter
      Then the picker shows 100 frames

    @issue-30
    Scenario: A 100-frame deck scrolls smoothly and adds one deck at most
      When the picker is scrolled from top to bottom
      Then no frame took longer than 200 ms
      And the picker added at most one iframe
