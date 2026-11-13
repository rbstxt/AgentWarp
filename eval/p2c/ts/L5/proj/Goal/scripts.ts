// L5 Goal: end-of-level flag. World position per level; screen position follows
// the camera like the platforms do.
whenBroadcastReceived("level1", () => {
  setVariableTo(vars.goalX, 380);
  setVariableTo(vars.goalY, -60);
  show();
});

whenBroadcastReceived("level2", () => {
  setVariableTo(vars.goalX, 240);
  setVariableTo(vars.goalY, 130);
  show();
});

whenFlagClicked(() => {
  forever(() => {
    setX(subtract(vars.goalX, vars.camX));
    setY(vars.goalY);
  });
});
