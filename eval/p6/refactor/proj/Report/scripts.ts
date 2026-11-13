// @a1
whenFlagClicked(() => {
  hideVariable(vars.Data);
  hide();
});

// @a2
whenBroadcastReceived("error", () => {
  goToXY(0, 0);
  goToFrontBack("front");
  show();
  showVariable(vars.Data);
});
