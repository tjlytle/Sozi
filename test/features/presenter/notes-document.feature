# covers: src/js/presenter.js, src/js/presenter/panels/NotesPanel.js, src/js/presenter/DisplayMirror.js, src/js/html/highlight.js, src/js/html/sanitize.js, src/js/player/DisplayChannel.js, src/js/protocol/messages.js, src/js/Storage.js, src/js/backend/Electron.js, src/templates/presenter.html, gulpfile.js
Feature: The notes as one document that follows the talk

  The same notes often cover several frames, and a speaker wants to read ahead. So the
  Notes panel shows the whole deck's notes as one scrolling document: a heading per frame
  that has notes, in deck order, with tables, task lists, highlighted code, links and
  images. A frame with no notes adds nothing to it.

  On a frame change the panel brings that frame's section to the top. A frame with no
  section moves nothing, so the notes being read stay through every slide they cover. A
  line above the document names the current frame whenever its heading is out of view,
  and the section covering the current frame has a quiet marker. A Follow toggle pauses
  the scrolling; turning it back on snaps to the current section. The font size comes back
  on this device.

  A notes file beside the deck is what the presenter shows, with no import. Remove it and
  the next build shows the notes in the JSON again. A presenter served over http also
  fetches the file published beside the deck, so a published file needs no rebuild.

  The "notes-document" deck has six frames: One (long notes), Two (only empty markup),
  Three (no notes), Four (a table, a task list, JavaScript, a link and an image), Five (no
  notes) and Six (two short lines). The "notes-file" deck has the same frames, other notes
  in its JSON, and a notes file whose sections say "fromfile" and hold a script.

  Rule: The document follows the talk

    Background:
      Given the "notes-document" deck is built
      And the presenter page is open

    @issue-31
    Scenario: The notes are one document, with a heading per frame that has notes
      Then the notes document has the headings "One, Four, Six"
      And the notes document shows a table, a task list and highlighted code
      And a screenshot "notes-document" is saved

    @issue-31
    Scenario: Frames that share notes do not move the panel
      When the next button is pressed
      And the next button is pressed
      Then the frame counter reads "3 / 6"
      And the section "One" is at the top of the notes
      When the next button is pressed
      Then the section "Four" is at the top of the notes

    @issue-31
    Scenario: A frame with no section leaves the notes where you scrolled them
      When the notes are scrolled to the section "Six"
      And the next button is pressed
      Then the section "Six" is at the top of the notes

    @issue-31
    Scenario: The title line and the marker say where the talk is
      Then the notes title line is hidden
      And the section "One" is marked as current
      When the next button is pressed
      And the notes are scrolled to the section "Six"
      Then the notes title line shows "Two"
      And the section "One" is marked as current
      And a screenshot "notes-title-line" is saved

    @issue-31
    Scenario: Pausing follow keeps the notes still, and resuming snaps to the current section
      When the follow toggle is pressed
      And the key "End" is pressed on the presenter page
      Then the frame counter reads "6 / 6"
      And the section "One" is at the top of the notes
      And the section "Six" is marked as current
      When the follow toggle is pressed
      Then the section "Six" is at the top of the notes

    @issue-31
    Scenario: The last section can reach the top
      When the key "End" is pressed on the presenter page
      Then the section "Six" is at the top of the notes

    @issue-31
    Scenario: A presenter page that reloads comes back at the current section
      When the key "End" is pressed on the presenter page
      Then the frame counter reads "6 / 6"
      When the audience transition has finished
      And the presenter page is reloaded
      Then the frame counter reads "6 / 6"
      And the audience window is on frame "Six"
      And the section "Six" is at the top of the notes

    @issue-31
    Scenario: The font size comes back on reload
      When the notes font size is increased
      And the presenter page is reloaded
      Then the notes font size is larger than the default
      And a screenshot "notes-font-size" is saved

  Rule: A notes file beside the deck

    @issue-31
    Scenario: The presenter shows the file, and removing it falls back to the JSON notes
      Given the "notes-file" deck is built
      And the presenter page is open
      Then the notes document contains "fromfile"
      And the notes document holds no script and no event handler attribute
      When the notes file is removed and the deck is rebuilt
      And the audience window is closed
      And the presenter page is reloaded
      Then the notes document does not contain "fromfile"

    @issue-31
    Scenario: A presenter served over http fetches the published file
      Given the "notes-document" deck is served over http with a notes file saying "published"
      When the presenter page is opened from the server
      Then the notes document contains "published"

    @issue-31
    Scenario: A presenter served over http with no notes file shows the JSON notes
      Given the "notes-document" deck is served over http
      When the presenter page is opened from the server
      Then the notes document has the headings "One, Four, Six"
