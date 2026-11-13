// L4 Stage: score/lives init + game-over watchdog.
whenFlagClicked(() => {
  setVariableTo(vars.score, 0);
  setVariableTo(vars.lives, 5);
  showVariable(vars.score);
  showVariable(vars.lives);
  forever(() => {
    ifThen(lessThan(vars.lives, 1), () => {
      broadcastAndWait("gameOver");
      stop("all");
    });
  });
});

whenBroadcastReceived("gameOver", () => {
  say("Game Over");
});
