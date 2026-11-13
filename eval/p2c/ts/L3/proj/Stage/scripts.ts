// L3 Stage: init score, show monitor, win backdrop on broadcast.
whenFlagClicked(() => {
  setVariableTo(vars.score, 0);
  showVariable(vars.score);
  switchBackdropTo("backdrop1");
});

whenBroadcastReceived("win", () => {
  switchBackdropTo("win");
});
