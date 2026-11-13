// L4 Stage (task ladder L4 — shooter). Owns score/lives and the gameOver
// broadcast. The main loop ends everything when lives run out.
whenFlagClicked(() => {
  setVariableTo(vars.score, 0);
  setVariableTo(vars.lives, 3);
  forever(() => {
    ifThen(lessThan(vars.lives, 1), () => {
      broadcastAndWait("gameOver");
      stop("all");
    });
  });
});

whenBroadcastReceived("gameOver", () => {
  sayFor("Game Over", 2);
});
