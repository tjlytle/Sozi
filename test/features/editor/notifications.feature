# covers: src/js/Controller.js, src/js/backend/AbstractBackend.js, src/css/sozi.editor.view.css
Feature: Notifications in the editor

  The editor shows errors and information in a notification panel: a title, Error or
  Information, and a body. The body is text: a file name or an error message reads as
  typed, never as markup. A help message with several entries, such as the list of
  formatting shortcuts of the notes field, still shows one entry per line.

  @issue-241
  Scenario: A help notification shows one line per entry
    Given the editor is open on a copy of the basic deck
    When the help of the notes field is clicked
    Then the notification title reads "Information"
    And the notification shows the line "Ctrl+>: Indent list entry"
