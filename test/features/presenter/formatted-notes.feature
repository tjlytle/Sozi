# covers: src/js/presenter.js, src/js/html/sanitize.js, test/fixtures/notes.sozi.json
Feature: Formatted presenter notes

  An author writes presenter notes with formatting: bold, headings, lists, links. The
  speaker sees that formatting in the presenter page. Notes are data from the deck,
  though, and a deck can come from anyone: a script or an event handler in the notes is
  removed before the notes are shown, and never runs in the speaker's page.

  The "notes" deck is the basic deck with notes: frame One has a paragraph with a bold
  word and a link; frame Two has a paragraph, a script and an image whose error handler
  would rename the page.

  Background:
    Given the "notes" deck is built
    And the presenter page is open

  @issue-241
  Scenario: Formatted notes show as formatting
    Then the notes body shows "hello" in bold
    And the notes body links to "https://example.org"
    And a screenshot "formatted-notes" is saved

  @issue-241
  Scenario: A script in the notes is removed and does not run
    When the next button is pressed
    Then the frame counter reads "2 / 2"
    And the notes body holds no script and no event handler attribute
    And the presenter page title is not "pwned"
