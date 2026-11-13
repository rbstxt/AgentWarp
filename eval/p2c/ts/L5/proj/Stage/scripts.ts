// L5 Stage: owns level data and level switching. Each platforms item encodes
// one rect as ((cx+250)*1000 + (top+200))*1000 + width (decoded by readers).
whenFlagClicked(() => {
  broadcast("level1");
});

// Switch to level 1: clear old platform clones, rebuild the list, respawn.
whenBroadcastReceived("level1", () => {
  setVariableTo(vars.level, 0);
  broadcast("clear");
  wait("0.3");
  setVariableTo(vars.level, 1);
  deleteAllOfList(lists.platforms);
  addToList(250100960, lists.platforms);
  addToList(100180120, lists.platforms);
  addToList(400260120, lists.platforms);
  broadcast("build");
});

// Switch to level 2 (staircase on the right side).
whenBroadcastReceived("level2", () => {
  setVariableTo(vars.level, 0);
  broadcast("clear");
  wait("0.3");
  setVariableTo(vars.level, 2);
  deleteAllOfList(lists.platforms);
  addToList(250100960, lists.platforms);
  addToList(330200120, lists.platforms);
  addToList(490290120, lists.platforms);
  broadcast("build");
});
