# covers: src/js/player/Media.js
Feature: Video and audio in the player

  A deck can hold a video or an audio clip, each with a frame where it starts and a
  frame where it stops. Before its start frame a clip waits; on its start frame it
  plays; on its stop frame it stops. A click on the video is the video's own (its
  controls), not a click on the slide, so it does not change frame.

  The "media" deck has three frames, a video and an audio clip that start on frame
  "Two" and stop on frame "Three"; the video shows its controls. Both clips loop, so a
  clip that is paused was stopped, not played to its end. The test browser lets media
  play without a gesture, so a clip that starts too early is seen to start.

  Background:
    Given the "media" deck is built
    And the deck page is open

  @issue-238
  Scenario: The video and the audio wait for their start frame
    Then the video is paused
    And the audio is paused

  @issue-238
  Scenario: The video and the audio start on their start frame and stop on their stop frame
    When the key "ArrowRight" is pressed
    Then the video is playing
    And the audio is playing
    When the key "ArrowRight" is pressed
    Then the video is paused
    And the audio is paused

  @issue-238
  Scenario: A click on the video does not change frame
    When the key "ArrowRight" is pressed
    And the video is clicked
    Then the player is on frame "Two"
