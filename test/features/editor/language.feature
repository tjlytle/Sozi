# covers: src/js/i18n.js, src/js/view/Properties.js, src/js/view/Toolbar.js
Feature: The language of the editor

  The editor speaks the language chosen in its preferences, or, by default, the
  language of the system. A regional system language such as Latin American Spanish
  falls back to its language when there is no regional translation. A system language
  Sozi has no translation for gives English.

  The regional example is es-419, not fr-CA: Chromium has no fr-CA locale of its own and
  hands the page "fr" first, so fr-CA never reaches the fallback; es-419 reaches it as
  it is, and Sozi translates only "es".

  The toolbar's Undo button is the witness: "Undo" in English, "Annuler" in French,
  "Deshacer" in Spanish.

  @issue-238
  Scenario: Choosing French in the preferences turns the editor French
    Given the editor is open on a copy of the basic deck
    When the toolbar button "Preferences" is pressed
    And the language "fr" is chosen
    Then the toolbar has a button titled "Annuler"

  @issue-238
  Scenario: A regional system language falls back to its language
    Given the editor is open on a copy of the basic deck with the system language "es-419"
    Then the toolbar has a button titled "Deshacer"

  @issue-238
  Scenario: A system language with no translation gives English
    Given the editor is open on a copy of the basic deck with the system language "zu"
    Then the toolbar has a button titled "Undo"
